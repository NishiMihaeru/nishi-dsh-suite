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
  decodeFrames,
  encodeFrame,
  type BridgeToolDeclaration,
} from '../src/mcp-bridge.ts'

/**
 * The tool bridge, tested without the vendor.
 *
 * The correlation rule these tests pin down is the one the vendor's process
 * model forces: a bridge server is a child of `agy`, not of the adapter, so
 * the only thing it can prove about itself is its parent pid. Everything else
 * -- which catalog it serves, whether it serves one at all -- follows from
 * whether a live adapter claims that parent.
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
  const host = await AgyMcpBridgeHost.listen(1_000)
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
  const first = decodeFrames('{"t":"hello","ppid":1}\n{"t":"cal')
  assert.deepEqual(first.frames, [{ t: 'hello', ppid: 1 }])
  assert.equal(first.rest, '{"t":"cal')
  const second = decodeFrames(first.rest + 'l","id":"a"}\nnot json\n{"t":"ping"}\n')
  assert.deepEqual(second.frames, [{ t: 'call', id: 'a' }, { t: 'ping' }])
  assert.equal(second.rest, '')
})

test('the adapter claims a server whose parent it spawned, and serves it the catalog', async () => {
  await withHost(async host => {
    host.expect(4242, TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', ppid: 4242 })
    const claim = await server.next()
    assert.equal(claim.t, 'claimed')
    assert.deepEqual(claim.tools.map((t: BridgeToolDeclaration) => t.name), ['read_file', 'memory_write'])
    server.end()
  })
})

test('a server whose parent no adapter claims is declined, so a stray agy session gets no tools', async () => {
  await withHost(async host => {
    host.expect(4242, TOOLS)
    const stray = fakeServer(host.socketPath)
    stray.send({ t: 'hello', ppid: 9999 })
    const answer = await stray.next()
    assert.equal(answer.t, 'unclaimed')
    stray.end()
  })
})

test('a hello that arrives before the adapter knows the child pid is matched when it registers', async () => {
  await withHost(async host => {
    // The adapter cannot register a pid it does not have yet: it learns the pid
    // only after spawning, while the child's server connects immediately.
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', ppid: 7777 })
    await new Promise(r => setTimeout(r, 50))
    host.expect(7777, TOOLS)
    const claim = await server.next()
    assert.equal(claim.t, 'claimed')
    assert.equal(claim.tools.length, 2)
    server.end()
  })
})

test('a vendor call surfaces to the adapter and its answer goes back to the same call id', async () => {
  await withHost(async host => {
    const channel = host.expect(4242, TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', ppid: 4242 })
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
    const channel = host.expect(4242, TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', ppid: 4242 })
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
    const channel = host.expect(4242, TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', ppid: 4242 })
    await server.next()
    const waiting = channel.next(AbortSignal.timeout(3_000))
    server.end()
    assert.equal(await waiting, undefined)
  })
})

test('disposing a channel stops serving that child', async () => {
  await withHost(async host => {
    const channel = host.expect(4242, TOOLS)
    const server = fakeServer(host.socketPath)
    server.send({ t: 'hello', ppid: 4242 })
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
  const host = await AgyMcpBridgeHost.listen(5_000)
  // The server reports process.ppid, and this test process is its parent, so
  // this is the same claim the adapter makes about the agy child it spawned.
  const channel = host.expect(process.pid, TOOLS)
  const child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, [BRIDGE_SOCKET_DIR_ENV]: dir },
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
  // directory that already exists -- verified, not assumed. The path is
  // predictable by design (the bridge server finds it without being told), so
  // it has to be checked rather than trusted.
  const parent = await mkdtemp(join(tmpdir(), 'bridge-perm-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  try {
    const loose = join(parent, 'loose')
    await mkdir(loose, { recursive: true, mode: 0o777 })
    await chmod(loose, 0o777)
    process.env[BRIDGE_SOCKET_DIR_ENV] = loose
    const host = await AgyMcpBridgeHost.listen(1_000)
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
    await assert.rejects(() => AgyMcpBridgeHost.listen(1_000), /is not a directory/)
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
  // with no tools. The claim window here is deliberately long: a sequential
  // implementation cannot pass this test.
  const dir = await mkdtemp(join(tmpdir(), 'bridge-hol-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const strangers = [await AgyMcpBridgeHost.listen(30_000), await AgyMcpBridgeHost.listen(30_000)]
  const owner = await AgyMcpBridgeHost.listen(30_000)
  // The owner's socket is created last, so a first-come scan reaches it last.
  const channel = owner.expect(process.pid, TOOLS)
  const child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, [BRIDGE_SOCKET_DIR_ENV]: dir },
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
