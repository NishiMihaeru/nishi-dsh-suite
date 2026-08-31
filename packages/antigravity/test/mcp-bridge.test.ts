import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  AgyMcpBridgeHost,
  BRIDGE_SOCKET_DIR_ENV,
  BRIDGE_SOCKET_ENV,
  BRIDGE_TOKEN_ENV,
  decodeFrames,
  encodeFrame,
  type BridgeToolDeclaration,
} from '../src/mcp-bridge.ts'

/**
 * The tool bridge, tested without the vendor.
 *
 * The correlation rule these tests pin down is the one the vendor's process
 * model forces: a bridge server is a child of `agy`, not of the adapter. The
 * adapter passes its socket path and a secret token through the environment;
 * the server connects to that socket and announces the token to claim its
 * tool catalog.
 *
 * The last test drives the real server process over real MCP stdio, so the
 * whole path is exercised end to end: the vendor's three calls (`initialize`,
 * `tools/list`, `tools/call`), the block while DSH executes, and the answer.
 */

const TOOLS: readonly BridgeToolDeclaration[] = [
  { name: 'read_file', description: 'read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'memory_write', description: 'write project memory', inputSchema: { type: 'object', properties: { topic: { type: 'string' } } } },
]

const SERVER_ENTRY = fileURLToPath(new URL('../src/mcp-bridge-server.ts', import.meta.url))

/** A raw adapter-socket client standing in for a bridge server process. */
function fakeServer(socketPath: string): {
  send: (frame: unknown) => void
  next: () => Promise<any>
  end: () => void
} {
  const socket = connect(socketPath)
  socket.setEncoding('utf8')
  let buffer = ''
  const queue: unknown[] = []
  const waiters: ((frame: unknown) => void)[] = []
  socket.on('data', chunk => {
    buffer += chunk
    const { frames, rest } = decodeFrames(buffer)
    buffer = rest
    for (const frame of frames) {
      const waiter = waiters.shift()
      if (waiter === undefined) queue.push(frame)
      else waiter(frame)
    }
  })
  socket.on('error', () => {})
  return {
    send: frame => { socket.write(encodeFrame(frame as any)) },
    next: () => queue.length > 0
      ? Promise.resolve(queue.shift())
      : new Promise(resolve => waiters.push(resolve)),
    end: () => socket.destroy(),
  }
}

async function withHost(fn: (host: AgyMcpBridgeHost, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-test-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const host = await AgyMcpBridgeHost.listen()
  try {
    await fn(host, dir)
  } finally {
    await host.close()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
}

test('a frame stream survives partial and malformed lines', () => {
  const first = decodeFrames('{"t":"hello","token":"tok-1"}\n{"t":"cal')
  assert.deepEqual(first.frames, [{ t: 'hello', token: 'tok-1' }])
  assert.equal(first.rest, '{"t":"cal')
  const second = decodeFrames(first.rest + 'l","id":"a"}\nnot json\n{"t":"ping"}\n')
  assert.deepEqual(second.frames, [{ t: 'call', id: 'a' }, { t: 'ping' }])
  assert.equal(second.rest, '')
})

test('the adapter claims a server whose token was registered, and serves it the catalog', async () => {
  await withHost(async host => {
    host.expect('tok-4242', TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', token: 'tok-4242' })
    const claim = await server.next()
    assert.equal(claim.t, 'claimed')
    assert.deepEqual(claim.tools.map((t: BridgeToolDeclaration) => t.name), ['read_file', 'memory_write'])
    server.end()
  })
})

test('a server whose token no adapter claims is declined, so a stray agy session gets no tools', async () => {
  await withHost(async host => {
    host.expect('tok-4242', TOOLS)
    const stray = fakeServer(host.socketPath)
    stray.send({ t: 'hello', token: 'tok-9999' })
    const answer = await stray.next()
    assert.equal(answer.t, 'unclaimed')
    stray.end()
  })
})

test('a vendor call surfaces to the adapter and its answer goes back to the same call id', async () => {
  await withHost(async host => {
    const channel = host.expect('tok-4242', TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', token: 'tok-4242' })
    await server.next()

    server.send({ t: 'call', id: 'bridge-1', name: 'read_file', arguments: { path: '/etc/hosts' } })
    const call = await channel.next(AbortSignal.timeout(2_000))
    assert.equal(call?.name, 'read_file')
    assert.deepEqual(call?.arguments, { path: '/etc/hosts' })
    assert.equal(channel.pending()?.id, 'bridge-1')

    channel.resolve('bridge-1', 'file contents here', false)
    const result = await server.next()
    assert.deepEqual(result, { t: 'result', id: 'bridge-1', text: 'file contents here', isError: false })
    assert.equal(channel.pending(), undefined)
    server.end()
  })
})

test('an answer citing an id that is not outstanding is ignored', async () => {
  await withHost(async host => {
    const channel = host.expect('tok-4242', TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', token: 'tok-4242' })
    await server.next()
    server.send({ t: 'call', id: 'bridge-1', name: 'read_file', arguments: {} })
    await channel.next(AbortSignal.timeout(2_000))

    // A stale result must not unblock the wrong call: the vendor turn is
    // waiting on exactly one id.
    channel.resolve('bridge-stale', 'wrong', false)
    channel.resolve('bridge-1', 'right', false)
    const result = await server.next()
    assert.equal(result.text, 'right')
    server.end()
  })
})

test('a vendor child that dies ends the wait rather than hanging the adapter', async () => {
  await withHost(async host => {
    const channel = host.expect('tok-4242', TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', token: 'tok-4242' })
    await server.next()
    const waiting = channel.next(AbortSignal.timeout(3_000))
    server.end()
    assert.equal(await waiting, undefined)
  })
})

test('disposing a channel stops serving that child', async () => {
  await withHost(async host => {
    const channel = host.expect('tok-4242', TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', token: 'tok-4242' })
    await server.next()
    channel.dispose()
    assert.equal(await channel.next(AbortSignal.timeout(1_000)), undefined)
    server.end()
  })
})

test('the real server process serves the catalog and blocks a call until DSH answers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-e2e-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const host = await AgyMcpBridgeHost.listen()
  const token = 'tok-e2e'
  const channel = host.expect(token, TOOLS)
  const child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      [BRIDGE_SOCKET_DIR_ENV]: dir,
      [BRIDGE_SOCKET_ENV]: host.socketPath,
      [BRIDGE_TOKEN_ENV]: token,
    },
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', c => { stderr += c })

  const replies = new Map<number, (value: any) => void>()
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    const { frames, rest } = decodeFrames(buffer)
    buffer = rest
    for (const frame of frames) {
      const message = frame as { id?: number; result?: unknown }
      const waiter = message.id === undefined ? undefined : replies.get(message.id)
      if (waiter !== undefined) { replies.delete(message.id!); waiter(message) }
    }
  })
  const rpc = (id: number, method: string, params?: unknown): Promise<any> => {
    const answer = new Promise<any>(resolve => replies.set(id, resolve))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } }) + '\n')
    return answer
  }

  try {
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18' })
    assert.equal(init.result.serverInfo.name, 'nishi-dsh-antigravity-bridge', `stderr: ${stderr}`)

    const listed = await rpc(2, 'tools/list')
    assert.deepEqual(
      listed.result.tools.map((t: BridgeToolDeclaration) => t.name),
      ['read_file', 'memory_write'],
      'the catalog must be the one the adapter claimed this child with',
    )
    assert.deepEqual(listed.result.tools[0].inputSchema, TOOLS[0].inputSchema)

    const calling = rpc(3, 'tools/call', { name: 'memory_write', arguments: { topic: 'bridge' } })
    const call = await channel.next(AbortSignal.timeout(5_000))
    assert.equal(call?.name, 'memory_write')
    assert.deepEqual(call?.arguments, { topic: 'bridge' })
    // A UUID, not a counter, and asserted here because this is the only test
    // that drives the real server. The id crosses into DSH as the tool-call id
    // verbatim, and a per-process counter restarts at one whenever a changed
    // request signature rebuilds the vendor child inside a live DSH session --
    // colliding with ids already written into that session's durable history.
    assert.match(call!.id, /^agy-mcp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    // The vendor turn must still be blocked here: this is the property the
    // whole design rests on, so assert it rather than assume it.
    let settledEarly = false
    void calling.then(() => { settledEarly = true })
    await new Promise(r => setTimeout(r, 300))
    assert.equal(settledEarly, false, 'tools/call answered before DSH executed the tool')

    channel.resolve(call!.id, 'wrote topic bridge', false)
    const answered = await calling
    assert.deepEqual(answered.result.content, [{ type: 'text', text: 'wrote topic bridge' }])
    assert.equal(answered.result.isError, false)
  } finally {
    child.kill('SIGTERM')
    await host.close()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('a socket directory another user could write into is refused, and our own loose one is tightened', async () => {
  // `mkdir(dir, {recursive: true, mode: 0o700})` does NOT change the mode of a
  // directory that already exists -- verified, not assumed. The directory sits
  // at a fixed well-known path, which any local user can pre-create, so it has
  // to be checked rather than trusted.
  const parent = await mkdtemp(join(tmpdir(), 'bridge-perm-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  try {
    const loose = join(parent, 'loose')
    await mkdir(loose, { recursive: true, mode: 0o777 })
    await chmod(loose, 0o777)
    process.env[BRIDGE_SOCKET_DIR_ENV] = loose
    const host = await AgyMcpBridgeHost.listen()
    try {
      const mode = (await stat(loose)).mode & 0o777
      assert.equal(mode & 0o077, 0, `our own directory must be tightened, got ${mode.toString(8)}`)
    } finally {
      await host.close()
    }

    const target = join(parent, 'target')
    await mkdir(target, { recursive: true, mode: 0o700 })
    const link = join(parent, 'link')
    await symlink(target, link)
    process.env[BRIDGE_SOCKET_DIR_ENV] = link
    await assert.rejects(() => AgyMcpBridgeHost.listen(), /is not a directory/)
  } finally {
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(parent, { recursive: true, force: true })
  }
})

test('an unrelated adapter on the machine does not delay a server finding its own', async () => {
  // The regression: the server used to offer to each socket in turn, and an
  // adapter that does not yet know the pid parks the offer for its whole claim
  // window. One unrelated adapter therefore cost a full window per turn, and
  // two of them exceeded the server's claim deadline entirely, leaving the model
  // with no tools.
  const dir = await mkdtemp(join(tmpdir(), 'bridge-hol-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const strangers = [await AgyMcpBridgeHost.listen(), await AgyMcpBridgeHost.listen()]
  const owner = await AgyMcpBridgeHost.listen()
  const token = 'tok-owner'
  const channel = owner.expect(token, TOOLS)
  const child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      [BRIDGE_SOCKET_DIR_ENV]: dir,
      [BRIDGE_SOCKET_ENV]: owner.socketPath,
      [BRIDGE_TOKEN_ENV]: token,
    },
  })
  child.stderr.resume()
  const replies = new Map<number, (value: any) => void>()
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    const { frames, rest } = decodeFrames(buffer)
    buffer = rest
    for (const frame of frames) {
      const message = frame as { id?: number }
      const waiter = message.id === undefined ? undefined : replies.get(message.id)
      if (waiter !== undefined) { replies.delete(message.id!); waiter(message) }
    }
  })
  const rpc = (id: number, method: string, params?: unknown): Promise<any> => {
    const answer = new Promise<any>(resolve => replies.set(id, resolve))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } }) + '\n')
    return answer
  }
  try {
    await rpc(1, 'initialize', { protocolVersion: '2025-06-18' })
    const started = Date.now()
    const listed = await rpc(2, 'tools/list')
    const elapsed = Date.now() - started
    assert.deepEqual(listed.result.tools.map((t: BridgeToolDeclaration) => t.name), ['read_file', 'memory_write'])
    assert.ok(elapsed < 5_000, `finding the owning adapter took ${elapsed}ms with two unrelated adapters present`)
    assert.equal(channel.attached(), true)
  } finally {
    child.kill('SIGTERM')
    await Promise.all([owner, ...strangers].map(host => host.close()))
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('closing the host does not wait out the claim window for a silent connection', async () => {
  // `server.close()` resolves only once every connection has ended, so a peer
  // that connects and then says nothing held disposal open for the whole claim
  // window -- tracked by neither the channel map nor the parked-hello map.
  const dir = await mkdtemp(join(tmpdir(), 'bridge-close-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const host = await AgyMcpBridgeHost.listen()
  try {
    const silent = connect(host.socketPath)
    silent.on('error', () => {})
    await new Promise(resolve => silent.once('connect', resolve))
    const started = Date.now()
    await host.close()
    const elapsed = Date.now() - started
    assert.ok(elapsed < 3_000, `close() waited ${elapsed}ms on a connection that never spoke`)
    silent.destroy()
  } finally {
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
})

/**
 * The capability the bridge hands out, and the one way it can leak.
 *
 * The adapter mints a token before it spawns `agy` and passes it through the
 * child's environment. Measured against real `agy 1.1.22`: the vendor passes
 * its environment to MCP servers verbatim -- 95 keys in, 95 keys out, nothing
 * injected and nothing dropped -- and it passes it to EVERY server it launches,
 * including third-party ones the user registered, not only ours. A probe
 * registered with no environment of its own still read the planted variable.
 *
 * So the token is readable by a co-resident server, and the thing that keeps
 * that from being a way in is that a token binds exactly once. The second
 * claimant is refused, and the legitimate server keeps the channel; if the
 * impostor wins the race instead, the real server is refused and the turn fails
 * loudly. Either way nobody is quietly served DSH's tools.
 */
test('a token binds to exactly one server, and a later claimant is refused rather than served', async () => {
  await withHost(async host => {
    const channel = host.expect('tok-alpha', TOOLS)

    const first = fakeServer(host.socketPath)
    first.send({ t: 'hello', token: 'tok-alpha' })
    const claimed = await first.next()
    assert.equal(claimed.t, 'claimed')
    assert.deepEqual(claimed.tools.map((tool: BridgeToolDeclaration) => tool.name), ['read_file', 'memory_write'])

    const second = fakeServer(host.socketPath)
    second.send({ t: 'hello', token: 'tok-alpha' })
    const refused = await second.next()
    assert.equal(refused.t, 'unclaimed', 'a bound token must not be honoured twice')
    assert.equal(refused.tools, undefined, 'a refused claimant must be told no catalog at all')

    // The channel still belongs to the server that bound it.
    first.send({ t: 'call', id: 'c1', name: 'read_file', arguments: { path: '/etc/hosts' } })
    const call = await channel.next(AbortSignal.timeout(2_000))
    assert.equal(call?.id, 'c1', 'the first claimant must keep the channel it bound')

    first.end()
    second.end()
  })
})

/**
 * A token names its channel outright, so an unknown one is answerable
 * immediately.
 *
 * Under the pid claim protocol this had to wait out a window: the adapter
 * learned its child's pid only after spawning it, so a hello for a pid nobody
 * had registered yet might still be claimed a moment later. A token is minted
 * BEFORE the spawn and registered before the child exists, which is what turns
 * "not yet" into "never" and lets the refusal be instant.
 */
test('an unknown token is refused at once, with no claim window to wait out', async () => {
  await withHost(async host => {
    host.expect('tok-real', TOOLS)
    const stray = fakeServer(host.socketPath)
    const started = Date.now()
    stray.send({ t: 'hello', token: 'tok-bogus' })
    const refused = await stray.next()
    assert.equal(refused.t, 'unclaimed')
    assert.ok(
      Date.now() - started < 500,
      'the refusal must be immediate: removing the claim window is the point of the token',
    )
    stray.end()
  })
})
