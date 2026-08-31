/**
 * Adapter side of the Antigravity MCP tool bridge.
 *
 * The vendor launches its own MCP servers from the user's global `agy`
 * configuration, so a bridge server is NOT a child of this adapter: it is a
 * child of the `agy` process the adapter spawned. Measured against real
 * `agy 1.1.22`: the vendor passes its environment to the MCP servers it
 * launches verbatim -- 95 keys in, 95 keys out, nothing injected and nothing
 * dropped -- and `agy mcp add --env` merges with that rather than replacing it.
 *
 * The adapter therefore mints a secret token before spawning and hands it
 * with the socket path to the child through the environment. Registered
 * before the child exists, the channel is ready before the server connects,
 * avoiding any need to park or wait for claims.
 *
 * Because the environment reaches every MCP server the vendor launches,
 * including third-party servers registered by the user, the token is visible
 * to co-resident servers. To prevent unauthorized access, each token binds
 * exactly once: the first claimant gets the channel, and every later claimant
 * for that token is refused outright. If an impostor races and claims the token,
 * the real server is refused and the turn fails loudly, ensuring no third party
 * is quietly served DSH's tools.
 *
 * This module executes nothing. A vendor call becomes a DSH `tool_calls`
 * reply, DSH's own agent loop executes it with its permissions, hooks and
 * durable history, and the result arrives on the next request and resolves the
 * blocked call -- the same shape `packages/codex` uses for App Server dynamic
 * tools.
 *
 * Internal to this package: not exported from `src/index.ts`.
 *
 * @module nishi-dsh-antigravity/mcp-bridge
 */
import { createServer, type Server, type Socket } from 'node:net'
import { chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Directory name holding one socket per live adapter. */
export const BRIDGE_SOCKET_DIR_NAME = 'nishi-agy-mcp-bridge'

/** Environment variable overriding the socket directory (tests, sandboxes). */
export const BRIDGE_SOCKET_DIR_ENV = 'NISHI_AGY_BRIDGE_DIR'

/** Environment variable passing the adapter's bridge socket path to the server. */
export const BRIDGE_SOCKET_ENV = 'NISHI_AGY_BRIDGE_SOCKET'

/** Environment variable passing the one-time secret claim token to the server. */
export const BRIDGE_TOKEN_ENV = 'NISHI_AGY_BRIDGE_TOKEN'

/** One DSH tool as the vendor's MCP client sees it. */
export interface BridgeToolDeclaration {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

/** One tool call the vendor made and is blocked on. */
export interface BridgeCall {
  /** Server-minted id, unique within one server process. */
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

/** Server -> adapter frames. */
export type BridgeUpstream =
  | { readonly t: 'hello'; readonly token: string }
  | { readonly t: 'call'; readonly id: string; readonly name: string; readonly arguments: unknown }

/** Adapter -> server frames. */
export type BridgeDownstream =
  | { readonly t: 'claimed'; readonly tools: readonly BridgeToolDeclaration[] }
  | { readonly t: 'unclaimed' }
  | { readonly t: 'result'; readonly id: string; readonly text: string; readonly isError: boolean }

/**
 * Refuse a socket directory that is not private to this user.
 *
 * Ownership and mode are both checked: another user's directory, or one any
 * local user can write into, would let a third party read the tool catalogs
 * DSH hands out and forge the frames that answer a blocked vendor turn. A
 * symlink is refused outright rather than followed.
 */
async function assertPrivateDirectory(dir: string): Promise<void> {
  const stats = await lstat(dir)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Antigravity MCP bridge directory ${JSON.stringify(dir)} is not a directory`)
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error(
      `Antigravity MCP bridge directory ${JSON.stringify(dir)} belongs to another user (uid ${stats.uid})`,
    )
  }
  if ((stats.mode & 0o077) !== 0) {
    // Ours and fixable: tighten rather than fail, since we may have created it
    // under a permissive umask.
    await chmod(dir, 0o700)
    const tightened = await lstat(dir)
    if ((tightened.mode & 0o077) !== 0) {
      throw new Error(
        `Antigravity MCP bridge directory ${JSON.stringify(dir)} is accessible to other users `
        + `(mode ${(tightened.mode & 0o777).toString(8)}) and could not be tightened`,
      )
    }
  }
}

/** Resolve the directory holding adapter sockets. */
export function bridgeSocketDir(): string {
  return process.env[BRIDGE_SOCKET_DIR_ENV] ?? join(tmpdir(), BRIDGE_SOCKET_DIR_NAME)
}

/** Encode one frame as a protocol line. */
export function encodeFrame(frame: BridgeUpstream | BridgeDownstream): string {
  return JSON.stringify(frame) + '\n'
}

/**
 * Split a growing buffer into complete lines, returning the parsed frames and
 * the unconsumed remainder. Unparseable lines are dropped: a peer that cannot
 * speak the protocol must not be able to crash the other side.
 */
export function decodeFrames(buffer: string): { frames: unknown[]; rest: string } {
  const frames: unknown[] = []
  let rest = buffer
  for (;;) {
    const nl = rest.indexOf('\n')
    if (nl < 0) break
    const line = rest.slice(0, nl).trim()
    rest = rest.slice(nl + 1)
    if (line.length === 0) continue
    try { frames.push(JSON.parse(line)) } catch { /* ignore a malformed line */ }
  }
  return { frames, rest }
}

/** A claimed vendor child's live call channel. */
export interface BridgeChannel {
  /**
   * Whether this child's bridge server ever connected and was claimed.
   *
   * False after a turn has run means the vendor never launched the server, which
   * is unambiguous in a way that "the model made no tool call" is not.
   */
  attached(): boolean
  /**
   * The vendor call currently blocked on the adapter, if any. Exactly one call
   * is outstanding at a time: the vendor turn cannot proceed past it.
   */
  pending(): BridgeCall | undefined
  /** Await the next vendor call. Resolves `undefined` once the child is gone. */
  next(signal: AbortSignal): Promise<BridgeCall | undefined>
  /** Answer the outstanding call, unblocking the vendor turn. */
  resolve(id: string, text: string, isError: boolean): void
  /** Stop serving this child; any outstanding call fails on the vendor side. */
  dispose(): void
}

interface ChannelState {
  readonly tools: readonly BridgeToolDeclaration[]
  socket: Socket | undefined
  /** Sticky: a child that attached and then died still counts as attached. */
  everAttached: boolean
  queue: BridgeCall[]
  outstanding: BridgeCall | undefined
  waiters: ((call: BridgeCall | undefined) => void)[]
  closed: boolean
}

/**
 * One socket per adapter instance, shared by every session it drives. The
 * socket must exist before a vendor child is spawned, because the child's
 * server connects within milliseconds of starting.
 */
export class AgyMcpBridgeHost {
  private readonly channels = new Map<string, ChannelState>()
  /**
   * Every connection currently open, whether or not it has said anything.
   *
   * `server.close()` resolves only once every connection has ended, so a peer
   * that connects and then says nothing used to hold `close()` open. Tracking
   * connections rather than only claims is what makes disposal prompt.
   */
  private readonly connections = new Set<Socket>()

  /** Set when the listening socket failed after startup; see `listen()`. */
  listenFailed = false

  private constructor(
    readonly socketPath: string,
    private readonly server: Server,
  ) {}

  /**
   * Start listening. The caller owns the returned host and must `close()` it.
   */
  static async listen(): Promise<AgyMcpBridgeHost> {
    const dir = bridgeSocketDir()
    await mkdir(dir, { recursive: true, mode: 0o700 })
    // `mkdir` with a mode does NOT change the mode of a directory that already
    // exists -- verified, not assumed. So the well-known path in the temp
    // directory can have been created by any local user, with any mode, before
    // this process ever ran: a world-writable one would put every adapter
    // socket, and with it every tool catalog, inside a directory an attacker can
    // enumerate and connect into. The directory stays at a fixed well-known
    // path even now that the server is TOLD its socket rather than finding it:
    // a fixed path is one any local user can pre-create, so it is verified
    // rather than trusted.
    await assertPrivateDirectory(dir)
    const socketPath = join(dir, `adapter-${process.pid}-${randomUUID()}.sock`)
    const server = createServer()
    const host = new AgyMcpBridgeHost(socketPath, server)
    server.on('connection', socket => host.onConnection(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => {
        server.removeListener('error', reject)
        // A listening server that errors later -- EMFILE, the socket file
        // pulled out from under it -- would otherwise be an unhandled 'error'
        // event, which takes the whole host process down. A bridge failure must
        // cost the route, never the process.
        server.on('error', () => { host.listenFailed = true })
        resolve()
      })
    })
    return host
  }

  /**
   * Declare the catalog a vendor child must be served, keyed by the secret
   * token minted for this process. Must be called before the vendor child is
   * spawned so the channel is ready when the server connects.
   */
  expect(token: string, tools: readonly BridgeToolDeclaration[]): BridgeChannel {
    const state: ChannelState = {
      tools,
      socket: undefined,
      everAttached: false,
      queue: [],
      outstanding: undefined,
      waiters: [],
      closed: false,
    }
    this.channels.set(token, state)
    return this.channelFor(token, state)
  }

  private channelFor(token: string, state: ChannelState): BridgeChannel {
    return {
      attached: () => state.everAttached,
      pending: () => state.outstanding,
      next: async (signal: AbortSignal) => {
        if (state.queue.length > 0) {
          const call = state.queue.shift()
          state.outstanding = call
          return call
        }
        if (state.closed) return undefined
        return await new Promise<BridgeCall | undefined>((resolve, reject) => {
          const onAbort = (): void => {
            state.waiters = state.waiters.filter(w => w !== waiter)
            reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
          }
          const waiter = (call: BridgeCall | undefined): void => {
            signal.removeEventListener('abort', onAbort)
            state.outstanding = call
            resolve(call)
          }
          if (signal.aborted) { onAbort(); return }
          signal.addEventListener('abort', onAbort, { once: true })
          state.waiters.push(waiter)
        })
      },
      resolve: (id, text, isError) => {
        if (state.outstanding?.id !== id) return
        state.outstanding = undefined
        state.socket?.write(encodeFrame({ t: 'result', id, text, isError }))
      },
      dispose: () => {
        this.channels.delete(token)
        state.closed = true
        for (const waiter of state.waiters.splice(0)) waiter(undefined)
        try { state.socket?.destroy() } catch { /* already gone */ }
      },
    }
  }

  private onConnection(socket: Socket): void {
    socket.setEncoding('utf8')
    this.connections.add(socket)
    socket.once('close', () => { this.connections.delete(socket) })
    let buffer = ''
    let boundToken: string | undefined
    socket.on('data', chunk => {
      buffer += chunk
      const { frames, rest } = decodeFrames(buffer)
      buffer = rest
      for (const raw of frames) {
        const frame = raw as BridgeUpstream
        if (frame?.t === 'hello' && typeof frame.token === 'string') {
          const state = this.channels.get(frame.token)
          if (state === undefined || state.everAttached || state.closed) {
            socket.write(encodeFrame({ t: 'unclaimed' }))
            socket.destroy()
            continue
          }
          boundToken = frame.token
          this.attach(state, socket)
          continue
        }
        if (frame?.t === 'call' && boundToken !== undefined) {
          const state = this.channels.get(boundToken)
          if (state === undefined || state.closed) continue
          const call: BridgeCall = { id: frame.id, name: frame.name, arguments: frame.arguments }
          const waiter = state.waiters.shift()
          if (waiter === undefined) state.queue.push(call)
          else waiter(call)
        }
      }
    })
    socket.on('error', () => { /* a vendor child dying is ordinary */ })
    socket.on('close', () => {
      if (boundToken === undefined) return
      const state = this.channels.get(boundToken)
      if (state === undefined) return
      state.socket = undefined
      state.closed = true
      for (const waiter of state.waiters.splice(0)) waiter(undefined)
    })
  }

  private attach(state: ChannelState, socket: Socket): void {
    state.socket = socket
    state.everAttached = true
    socket.write(encodeFrame({ t: 'claimed', tools: state.tools }))
  }

  /** Stop listening and remove the socket file. */
  async close(): Promise<void> {
    for (const [, state] of this.channels) {
      state.closed = true
      for (const waiter of state.waiters.splice(0)) waiter(undefined)
      try { state.socket?.destroy() } catch { /* already gone */ }
    }
    this.channels.clear()
    for (const socket of this.connections) {
      try { socket.destroy() } catch { /* already gone */ }
    }
    this.connections.clear()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
    await rm(this.socketPath, { force: true }).catch(() => {})
  }
}

