/**
 * The MCP stdio server the vendor launches for the tool bridge.
 *
 * This process is spawned by `agy`, not by DSH, so it starts knowing nothing
 * except its own parent pid. It finds the adapter that owns that parent by
 * announcing the pid on every adapter socket it can see; the owning adapter
 * answers with the tool catalog for that vendor child, and every other adapter
 * declines. A server no adapter claims serves an EMPTY catalog -- that is what
 * keeps a globally registered bridge from handing DSH's tools to an unrelated
 * `agy` session on the same machine.
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
import { connect, type Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import {
  decodeFrames,
  encodeFrame,
  listAdapterSockets,
  type BridgeDownstream,
  type BridgeToolDeclaration,
} from './mcp-bridge.js'

/** How long to wait for some adapter to claim this server before serving nothing. */
const CLAIM_TIMEOUT_MS = 15_000

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
 * Announce this server's parent pid on one adapter socket.
 * @returns the claim, or `undefined` if that adapter declined or went away.
 */
function offer(path: string, ppid: number, outstanding: Map<string, Outstanding>): Promise<Claim | undefined> {
  return new Promise<Claim | undefined>(resolve => {
    let settled = false
    const done = (claim: Claim | undefined): void => {
      if (settled) return
      settled = true
      resolve(claim)
    }
    const socket = connect(path)
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
    socket.on('connect', () => { socket.write(encodeFrame({ t: 'hello', ppid })) })
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

/**
 * Find the adapter that owns this server's parent, offering to every socket at
 * once.
 *
 * Concurrently, not in sequence, and that is the whole point. An adapter that
 * does not yet know the pid parks the offer for its claim window rather than
 * declining immediately -- deliberately, because the adapter learns its child's
 * pid only after spawning it. Probing sequentially therefore made one unrelated
 * adapter on the machine cost a full claim window per turn, and two of them
 * exceed this deadline outright, leaving the model with no tools at all.
 *
 * Losing offers are closed as soon as one claim wins, so a parked offer does not
 * outlive the search.
 */
async function findAdapter(outstanding: Map<string, Outstanding>): Promise<Claim | undefined> {
  const deadline = Date.now() + CLAIM_TIMEOUT_MS
  for (;;) {
    const paths = await listAdapterSockets()
    if (paths.length > 0) {
      const offers = paths.map(path => offer(path, process.ppid, outstanding))
      const claim = await firstClaim(offers)
      if (claim !== undefined) return claim
    }
    if (Date.now() >= deadline) return undefined
    await new Promise(r => setTimeout(r, 250))
  }
}

/**
 * The first offer to be claimed, with every other claimed socket closed.
 *
 * Two adapters cannot both legitimately claim one parent pid, but a buggy or
 * hostile peer could answer for a pid it does not own; taking the first and
 * closing the rest keeps exactly one channel either way.
 */
function firstClaim(offers: readonly Promise<Claim | undefined>[]): Promise<Claim | undefined> {
  if (offers.length === 0) return Promise.resolve(undefined)
  return new Promise<Claim | undefined>(resolve => {
    let decided = false
    let pending = offers.length
    const declined = (): void => {
      pending -= 1
      // Only every offer declining is an answer. Waiting for all of them when
      // one has already claimed would reintroduce exactly the stall this
      // function exists to remove: a parked offer settles at its adapter's
      // claim window, not at ours.
      if (pending === 0 && !decided) { decided = true; resolve(undefined) }
    }
    for (const promise of offers) {
      void promise.then(claim => {
        if (claim === undefined) { declined(); return }
        if (decided) {
          // A late second claimant for the same parent pid: keep one channel.
          try { claim.socket.destroy() } catch { /* already gone */ }
          return
        }
        decided = true
        resolve(claim)
      }, declined)
    }
  })
}

export async function main(): Promise<void> {
  const outstanding = new Map<string, Outstanding>()
  const claimed = findAdapter(outstanding)
  let nextCallId = 0

  const toolsFor = async (): Promise<readonly BridgeToolDeclaration[]> => (await claimed)?.tools ?? []

  const callTool = async (name: string, args: unknown): Promise<{ text: string; isError: boolean }> => {
    const claim = await claimed
    if (claim === undefined) {
      return { text: 'This DSH tool bridge is not attached to a DeepSeek Harness session, so it has no tools.', isError: true }
    }
    const id = `bridge-${++nextCallId}`
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
