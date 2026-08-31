/**
 * Adapter side of the Antigravity MCP tool bridge.
 *
 * The vendor launches its own MCP servers from the user's global `agy`
 * configuration, so a bridge server is NOT a child of this adapter: it is a
 * child of the `agy` process the adapter spawned. Probed against real
 * `agy 1.1.22`: exactly one server process per `agy` process, its `ppid` is
 * the `agy` pid the adapter itself spawned, and it receives `initialize` plus
 * `tools/list` within 4ms of vendor start -- before the adapter has said
 * anything. Two consequences shape everything below.
 *
 * First, correlation is by parent pid. A server announces its `ppid`; only the
 * adapter that spawned that exact process claims it. A server whose parent no
 * adapter claims is served an EMPTY catalog, which is what keeps a globally
 * registered server from handing DSH's tools to an unrelated `agy` session on
 * the same machine.
 *
 * Second, `tools/list` arrives before the adapter can answer it, so the server
 * blocks until its claim lands. The catalog is therefore fixed for the life of
 * one vendor child, which matches the rule already enforced by
 * `requestSignature`: a changed tool catalog rebuilds the child rather than
 * revising a live conversation.
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
import { mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Directory name holding one socket per live adapter, scanned by servers. */
export const BRIDGE_SOCKET_DIR_NAME = 'nishi-agy-mcp-bridge'

/** Environment variable overriding the socket directory (tests, sandboxes). */
export const BRIDGE_SOCKET_DIR_ENV = 'NISHI_AGY_BRIDGE_DIR'

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
  | { readonly t: 'hello'; readonly ppid: number }
  | { readonly t: 'call'; readonly id: string; readonly name: string; readonly arguments: unknown }

/** Adapter -> server frames. */
export type BridgeDownstream =
  | { readonly t: 'claimed'; readonly tools: readonly BridgeToolDeclaration[] }
  | { readonly t: 'unclaimed' }
  | { readonly t: 'result'; readonly id: string; readonly text: string; readonly isError: boolean }

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
  private readonly channels = new Map<number, ChannelState>()
  /** Hellos that arrived before the adapter registered the pid they name. */
  private readonly earlyHellos = new Map<number, Socket>()

  /** Set when the listening socket failed after startup; see `listen()`. */
  listenFailed = false

  private constructor(
    readonly socketPath: string,
    private readonly server: Server,
    private readonly claimWindowMs: number,
  ) {}

  /**
   * Start listening. The caller owns the returned host and must `close()` it.
   * @param claimWindowMs - how long an unmatched server waits before it is
   *   told it is unclaimed and serves an empty catalog.
   */
  static async listen(claimWindowMs = 10_000): Promise<AgyMcpBridgeHost> {
    const dir = bridgeSocketDir()
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const socketPath = join(dir, `adapter-${process.pid}-${randomUUID()}.sock`)
    const server = createServer()
    const host = new AgyMcpBridgeHost(socketPath, server, claimWindowMs)
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
   * Declare the catalog a vendor child must be served, keyed by the pid of the
   * `agy` process this adapter spawned. Safe to call after the child's server
   * has already connected: an early hello is matched here.
   */
  expect(agyPid: number, tools: readonly BridgeToolDeclaration[]): BridgeChannel {
    const state: ChannelState = {
      tools,
      socket: undefined,
      everAttached: false,
      queue: [],
      outstanding: undefined,
      waiters: [],
      closed: false,
    }
    this.channels.set(agyPid, state)
    const early = this.earlyHellos.get(agyPid)
    if (early !== undefined) {
      this.earlyHellos.delete(agyPid)
      this.attach(agyPid, state, early)
    }
    return this.channelFor(agyPid, state)
  }

  private channelFor(agyPid: number, state: ChannelState): BridgeChannel {
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
        this.channels.delete(agyPid)
        state.closed = true
        for (const waiter of state.waiters.splice(0)) waiter(undefined)
        try { state.socket?.destroy() } catch { /* already gone */ }
      },
    }
  }

  private onConnection(socket: Socket): void {
    socket.setEncoding('utf8')
    let buffer = ''
    let claimedPid: number | undefined
    let holdTimer: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      if (claimedPid === undefined) {
        socket.write(encodeFrame({ t: 'unclaimed' }))
        socket.destroy()
      }
    }, this.claimWindowMs)
    timer.unref?.()
    socket.on('data', chunk => {
      buffer += chunk
      const { frames, rest } = decodeFrames(buffer)
      buffer = rest
      for (const raw of frames) {
        const frame = raw as BridgeUpstream
        if (frame?.t === 'hello' && typeof frame.ppid === 'number') {
          claimedPid = frame.ppid
          clearTimeout(timer)
          const state = this.channels.get(frame.ppid)
          if (state === undefined) {
            // The adapter may not have registered this pid yet: it spawns the
            // child and only then knows its pid, while the child's server
            // connects immediately. Hold the socket for `expect()` to match.
            this.earlyHellos.set(frame.ppid, socket)
            holdTimer = setTimeout(() => {
              if (this.earlyHellos.get(frame.ppid) === socket) {
                this.earlyHellos.delete(frame.ppid)
                socket.write(encodeFrame({ t: 'unclaimed' }))
                socket.destroy()
              }
            }, this.claimWindowMs)
            holdTimer.unref?.()
            continue
          }
          this.attach(frame.ppid, state, socket)
          continue
        }
        if (frame?.t === 'call' && claimedPid !== undefined) {
          const state = this.channels.get(claimedPid)
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
      clearTimeout(timer)
      if (claimedPid === undefined) return
      // A hello whose pid no adapter had registered yet is parked in
      // `earlyHellos` with its own timer. Dropping the socket without clearing
      // both leaves a dead entry and a live timer behind for the hold window.
      if (this.earlyHellos.get(claimedPid) === socket) {
        this.earlyHellos.delete(claimedPid)
        clearTimeout(holdTimer)
      }
      const state = this.channels.get(claimedPid)
      if (state === undefined) return
      state.socket = undefined
      state.closed = true
      for (const waiter of state.waiters.splice(0)) waiter(undefined)
    })
  }

  private attach(agyPid: number, state: ChannelState, socket: Socket): void {
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
    for (const [, socket] of this.earlyHellos) {
      try { socket.destroy() } catch { /* already gone */ }
    }
    this.earlyHellos.clear()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
    await rm(this.socketPath, { force: true }).catch(() => {})
  }
}

/**
 * List adapter sockets a bridge server should try, newest first. Ordering is a
 * heuristic only: correctness rests on the `ppid` claim, not on which socket
 * is tried first.
 */
export async function listAdapterSockets(dir = bridgeSocketDir()): Promise<string[]> {
  const entries = await readdir(dir).catch(() => [] as string[])
  return entries.filter(name => name.startsWith('adapter-') && name.endsWith('.sock')).map(name => join(dir, name))
}
