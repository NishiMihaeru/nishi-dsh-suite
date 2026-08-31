/**
 * The MCP stdio server the vendor launches for the tool bridge.
 *
 * This process is spawned by `agy`, not directly by DSH. The adapter passes
 * the bridge socket path and a single-use secret token through its environment.
 * The server connects directly to that socket and announces the token to claim
 * its tool catalog. If the environment variables are absent, this server was
 * launched by an unrelated `agy` session on the machine; it serves an EMPTY
 * catalog and declines all tool calls, keeping globally registered bridge
 * tools isolated to DSH sessions.
 *
 * It executes nothing. A `tools/call` is forwarded to the adapter and this
 * process blocks until an answer arrives, which is the whole point: the vendor
 * turn stays open while DSH's own agent loop runs the tool with its
 * permissions, hooks and durable history. Probed on real `agy 1.1.22`: a call
 * held 9.2s completed normally and its result reached the model inside the
 * same vendor turn.
 *
 * Run as its own process, registered with the vendor once per machine:
 *   agy mcp add dshtools node <install>/lib/mcp-bridge-server.js
 *
 * @module nishi-dsh-antigravity/mcp-bridge-server
 */
import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import {
  BRIDGE_SOCKET_ENV,
  BRIDGE_TOKEN_ENV,
  decodeFrames,
  encodeFrame,
  type BridgeDownstream,
  type BridgeToolDeclaration,
} from './mcp-bridge.js'

/** A tool call awaiting the adapter's answer. */
interface Outstanding {
  resolve: (result: { text: string; isError: boolean }) => void
}

interface Claim {
  readonly socket: Socket
  readonly tools: readonly BridgeToolDeclaration[]
}

const send = (message: unknown): void => { process.stdout.write(JSON.stringify(message) + '\n') }
const ok = (id: unknown, result: unknown): void => { send({ jsonrpc: '2.0', id, result }) }

/**
 * Connect to the adapter socket and claim the tool channel with the token.
 * @returns the claim, or `undefined` if the adapter declined or went away.
 */
function connectToBridge(
  socketPath: string,
  token: string,
  outstanding: Map<string, Outstanding>,
): Promise<Claim | undefined> {
  return new Promise<Claim | undefined>(resolve => {
    let settled = false
    const done = (claim: Claim | undefined): void => {
      if (settled) return
      settled = true
      resolve(claim)
    }
    const socket = connect(socketPath)
    socket.setEncoding('utf8')
    socket.on('error', () => { done(undefined) })
    socket.on('close', () => {
      done(undefined)
      // A claimed adapter going away must not leave the vendor turn hanging
      // forever: fail every outstanding call so the model gets a real error.
      for (const [, call] of outstanding) {
        call.resolve({ text: 'The DSH tool bridge closed before this call was answered.', isError: true })
      }
      outstanding.clear()
    })
    socket.on('connect', () => { socket.write(encodeFrame({ t: 'hello', token })) })
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk
      const { frames, rest } = decodeFrames(buffer)
      buffer = rest
      for (const raw of frames) {
        const frame = raw as BridgeDownstream
        if (frame?.t === 'claimed') { done({ socket, tools: frame.tools ?? [] }); continue }
        if (frame?.t === 'unclaimed') { socket.destroy(); done(undefined); continue }
        if (frame?.t === 'result') {
          const call = outstanding.get(frame.id)
          if (call === undefined) continue
          outstanding.delete(frame.id)
          call.resolve({ text: frame.text, isError: frame.isError })
        }
      }
    })
  })
}

export async function main(): Promise<void> {
  const socketPath = process.env[BRIDGE_SOCKET_ENV]
  const token = process.env[BRIDGE_TOKEN_ENV]
  const outstanding = new Map<string, Outstanding>()
  const claimed: Promise<Claim | undefined> = socketPath && token
    ? connectToBridge(socketPath, token, outstanding)
    : Promise.resolve(undefined)

  const toolsFor = async (): Promise<readonly BridgeToolDeclaration[]> => (await claimed)?.tools ?? []

  const callTool = async (name: string, args: unknown): Promise<{ text: string; isError: boolean }> => {
    const claim = await claimed
    if (claim === undefined) {
      return { text: 'This DSH tool bridge is not attached to a DeepSeek Harness session, so it has no tools.', isError: true }
    }
    const id = `agy-mcp-${randomUUID()}`
    return await new Promise<{ text: string; isError: boolean }>(resolve => {
      outstanding.set(id, { resolve })
      claim.socket.write(encodeFrame({ t: 'call', id, name, arguments: args }))
    })
  }

  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    buffer += chunk
    const { frames, rest } = decodeFrames(buffer)
    buffer = rest
    for (const raw of frames) {
      const message = raw as { id?: unknown; method?: string; params?: Record<string, unknown> }
      const { id, method, params } = message
      if (method === 'initialize') {
        ok(id, {
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'nishi-dsh-antigravity-bridge', version: '0.1.0-rc.3' },
        })
        continue
      }
      if (method === 'tools/list') {
        // The vendor asks at startup, before the adapter has claimed this
        // server. Blocking here is deliberate: answering early would advertise
        // an empty catalog for the life of the child.
        void toolsFor().then(tools => ok(id, {
          tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
        }))
        continue
      }
      if (method === 'tools/call') {
        const name = typeof params?.name === 'string' ? params.name : ''
        void callTool(name, params?.arguments).then(result => ok(id, {
          content: [{ type: 'text', text: result.text }],
          isError: result.isError,
        }))
        continue
      }
      if (method === 'ping') { ok(id, {}); continue }
      if (method?.startsWith('notifications/')) continue
      if (id !== undefined) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(method)}` } })
      }
    }
  })
  process.stdin.on('end', () => { process.exit(0) })
}

// Entry point when the vendor launches this file directly. Kept explicit so
// the module can also be imported by tests without starting a server.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}

