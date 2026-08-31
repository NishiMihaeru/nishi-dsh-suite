import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import {
  BRIDGE_SOCKET_DIR_ENV,
  decodeFrames,
  encodeFrame,
  listAdapterSockets,
} from '../src/mcp-bridge.ts'
import {
  bridgeEligible,
  bridgeMcpAgentMarkdown,
  bridgeToolDeclarations,
  bridgeToolResult,
  VENDOR_FINISH_TOOL,
  VENDOR_MCP_TOOL,
} from '../src/mcp-transport.ts'

/**
 * The `mcp-bridge` transport.
 *
 * The last test is the one that matters: it drives a full DSH step pair
 * through the adapter with a fake vendor child and a fake bridge server, and
 * asserts the property the transport exists for -- the vendor turn stays open
 * across the tool call, so the model receives a real result inside the turn it
 * asked from, and DSH's loop is what executed the tool.
 */

const TOOLS = [
  { name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], $ref: '#/x' } },
]

const CATALOG = ['gemini-3.7-flash-low\tGemini 3.7 Flash (Low)'].join('\n')

const baseConfig = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 200,
  stderrMaxBytes: 64_000,
  contextWindowTokens: 200_000,
  // Generous on purpose: a vendor turn on this transport stays open across DSH
  // steps, so an idle reaper measured in milliseconds would close the session
  // between the tool call and its result.
  sessionIdleMs: 60_000,
  transport: 'mcp-bridge' as const,
}

test('the bridge agent allowlist is finish alone, and never names the vendor MCP wrapper', () => {
  const md = bridgeMcpAgentMarkdown()
  const tools = md.slice(md.indexOf('tools:'), md.indexOf('---', md.indexOf('tools:')))
    .split('\n').filter(line => line.startsWith('  - ')).map(line => line.slice(4))
  assert.deepEqual(tools, [VENDOR_FINISH_TOOL])
  // Naming call_mcp_tool here terminates the agent on real agy 1.1.22 --
  // `Agent execution terminated due to error.`, zero tokens -- and is also
  // unnecessary, because MCP tools are not gated by this allowlist. Probed,
  // after the obvious spelling of this list killed every live turn.
  assert.ok(!tools.includes(VENDOR_MCP_TOOL))
  assert.match(md, /inheritCustomizations: false/)
  // The probe watched the vendor's default agent read a file outside the
  // workspace with view_file, so the absence of native tools is the point.
  assert.doesNotMatch(md, /view_file|run_command|browser_/)
})

test('a tool schema crosses the bridge unmodified, including keywords the forced schema cannot express', () => {
  const declared = bridgeToolDeclarations(TOOLS as any)
  assert.equal(declared.length, 1)
  assert.deepEqual(declared[0]?.inputSchema, TOOLS[0]?.parameters)
  // `$ref` makes the schema transport abandon that tool to an untyped object.
  // MCP carries it verbatim, so the rewriting apparatus does not apply here.
  assert.equal((declared[0]?.inputSchema as any).$ref, '#/x')
})

test('a tool result is found by call id, not by position', () => {
  const messages = [
    { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-a', name: 'read_file', arguments: '{}' }] },
    { id: 'm2', role: 'user', content: [
      { type: 'tool-result', toolCallId: 'call-b', content: [{ type: 'text', text: 'other' }] },
      { type: 'tool-result', toolCallId: 'call-a', content: [{ type: 'text', text: 'hosts file' }] },
    ] },
    { id: 'm3', role: 'user', content: [{ type: 'text', text: 'unrelated trailing message' }] },
  ]
  assert.deepEqual(bridgeToolResult(messages as any, 'call-a'), { text: 'hosts file', isError: false })
  assert.deepEqual(bridgeToolResult(messages as any, 'call-b'), { text: 'other', isError: false })
  assert.equal(bridgeToolResult(messages as any, 'call-missing'), undefined)
})

test('an error result keeps its error flag, and unreadable content is named rather than dropped', () => {
  const messages = [{ id: 'm1', role: 'user', content: [
    { type: 'tool-result', toolCallId: 'c', isError: true, content: [{ type: 'text', text: 'boom' }, { type: 'image', url: 'x' }] },
  ] }]
  const projected = bridgeToolResult(messages as any, 'c')
  assert.equal(projected?.isError, true)
  assert.match(projected!.text, /^boom\n\[image content omitted/)
})

test('an auxiliary call and a toolless request never use the bridge', () => {
  assert.equal(bridgeEligible(undefined, TOOLS as any), true)
  // Compaction answering with a tool call is what the message-only schema
  // fixed; a live catalog on that path would reintroduce it.
  assert.equal(bridgeEligible('compaction', TOOLS as any), false)
  assert.equal(bridgeEligible(undefined, []), false)
  assert.equal(bridgeEligible(undefined, undefined), false)
})

/** A vendor child whose stdout the test controls, so a turn can stay open. */
function controllableChild(pid: number) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const written: string[] = []
  stdin.on('data', chunk => { written.push(String(chunk)) })
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  return {
    handle: {
      pid,
      stdin,
      stdout,
      stderr: undefined,
      collected: {
        stdout: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
        stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
      },
      done: done.promise,
      terminate() { stdout.end(); done.resolve({ exitCode: 0, signal: null }) },
      async waitForExit() { await done.promise; return true },
    },
    written,
    /** Emit one vendor step event, as the stream-json log would carry it. */
    emitToolStep(toolName: string) {
      stdout.write(JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'c1', step_index: 1, state: 'DONE', step_type: 'tool', tool_name: toolName },
      }) + '\n')
    },
    /** Emit the vendor's end-of-turn event, closing the open turn. */
    finishTurn(response: string) {
      stdout.write(JSON.stringify({
        event: 'result',
        result: { conversation_id: 'c1', status: 'SUCCESS', response, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } },
      }) + '\n')
    },
  }
}

function collected(text: string) {
  const stdout = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => { stdout.write(text); stdout.end(); done.resolve({ exitCode: 0, signal: null }) })
  return {
    pid: 999,
    stdin: new PassThrough(),
    stdout,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text, nextOffset: text.length, lossy: false } } },
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}

test('the bridge argv drops the forced schema and selects the bridge agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-argv-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const child = controllableChild(3100)
  let turnArgv: readonly string[] = []
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
        if (spec.argv.includes('models')) {
          return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
        }
        turnArgv = spec.argv
        return child.handle
      },
    },
  }
  const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
  try {
    const stream = adapter.stream({
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: TOOLS,
    } as any)
    const iterator = stream[Symbol.asyncIterator]()
    const first = iterator.next()
    // Give the adapter time to reach the spawn, then end the turn so the
    // stream can settle rather than waiting on a vendor that never answers.
    await new Promise(r => setTimeout(r, 250))
    child.finishTurn('done')
    await first
    void iterator.return?.()
  } finally {
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }

  assert.ok(!turnArgv.includes('--json-schema'), `argv still forces a schema: ${turnArgv.join(' ')}`)
  assert.equal(turnArgv[turnArgv.indexOf('--agent') + 1], 'dsh-primary-mcp')
  assert.ok(turnArgv.includes('--sandbox'))
})

test('a vendor tool call becomes a DSH tool call, and its result reaches the still-open vendor turn', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-flow-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const child = controllableChild(3200)
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
        if (spec.argv.includes('models')) {
          return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
        }
        return child.handle
      },
    },
  }
  const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
  let server: ReturnType<typeof connect> | undefined
  try {
    const request = {
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'read /etc/hosts' }] }],
      tools: TOOLS,
    }

    // Step one: drive the stream, and stand in for the bridge server the
    // vendor would have launched -- claiming the child by its pid, then asking
    // for a DSH tool.
    const firstChunks: any[] = []
    const firstStep = (async () => {
      for await (const chunk of adapter.stream(request as any)) firstChunks.push(chunk)
    })()

    let claimedTools: any[] = []
    const serverFrames: any[] = []
    await new Promise(r => setTimeout(r, 300))
    const sockets = await listAdapterSockets(dir)
    assert.equal(sockets.length, 1, 'the adapter must be listening before its child is spawned')
    server = connect(sockets[0]!)
    server.setEncoding('utf8')
    let buffer = ''
    server.on('data', c => {
      buffer += c
      const { frames, rest } = decodeFrames(buffer)
      buffer = rest
      for (const frame of frames) {
        serverFrames.push(frame)
        if ((frame as any).t === 'claimed') claimedTools = (frame as any).tools
      }
    })
    server.write(encodeFrame({ t: 'hello', ppid: 3200 }))
    await new Promise(r => setTimeout(r, 150))
    assert.deepEqual(claimedTools.map(t => t.name), ['read_file'], 'the child must be served this request\'s catalog')

    server.write(encodeFrame({ t: 'call', id: 'bridge-1', name: 'read_file', arguments: { path: '/etc/hosts' } } as any))
    await firstStep

    const toolCall = firstChunks.find(c => c.type === 'block-end' && c.block?.type === 'tool-call')
    assert.ok(toolCall, `expected a DSH tool call, got ${JSON.stringify(firstChunks)}`)
    assert.equal(toolCall.block.name, 'read_file')
    assert.deepEqual(JSON.parse(toolCall.block.arguments), { path: '/etc/hosts' })
    assert.deepEqual(firstChunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
    // The step reports no usage: the vendor turn has not finished counting.
    assert.equal(firstChunks.some(c => c.type === 'usage'), false)

    // Step two: DSH executed the tool and appends its result. The adapter must
    // answer the blocked call rather than write a new line to the vendor.
    const linesBefore = child.written.length
    const secondChunks: any[] = []
    const secondStep = (async () => {
      for await (const chunk of adapter.stream({
        ...request,
        messages: [
          ...request.messages,
          { id: 'm2', role: 'assistant', content: [{ type: 'tool-call', id: toolCall.block.id, name: 'read_file', arguments: toolCall.block.arguments }] },
          { id: 'm3', role: 'user', content: [{ type: 'tool-result', toolCallId: toolCall.block.id, content: [{ type: 'text', text: '127.0.0.1 localhost' }] }] },
        ],
      } as any)) secondChunks.push(chunk)
    })()

    await new Promise(r => setTimeout(r, 200))
    const result = serverFrames.find(f => f.t === 'result')
    assert.ok(result, `the blocked call was never answered: ${JSON.stringify(serverFrames)}`)
    assert.equal(result.id, 'bridge-1')
    assert.equal(result.text, '127.0.0.1 localhost')
    assert.equal(result.isError, false)
    assert.equal(child.written.length, linesBefore, 'answering a blocked call must not write a new vendor turn')

    child.finishTurn('the hosts file says 127.0.0.1 localhost')
    await secondStep
    const text = secondChunks.find(c => c.type === 'block-end' && c.block?.type === 'text')
    assert.equal(text.block.text, 'the hosts file says 127.0.0.1 localhost')
    assert.deepEqual(secondChunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    assert.ok(secondChunks.some(c => c.type === 'usage'), 'the finished turn must report usage')
  } finally {
    server?.destroy()
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('the transport refuses to run when its bridge server is not registered with the vendor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-unreg-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[] }) {
        if (spec.argv.includes('list')) return collected('No MCP servers configured.\n')
        return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
      },
    },
  }
  const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
  try {
    await assert.rejects(
      async () => {
        for await (const _ of adapter.stream({
          provider: 'antigravity-cli',
          model: 'gemini-3.7-flash-low',
          sessionId: 's1',
          messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          tools: TOOLS,
        } as any)) { /* must not get here */ }
      },
      // Silence is the failure mode worth preventing: an unregistered bridge
      // hands the model no tools at all, which reads as a disobedient model.
      /not registered with agy/,
    )
  } finally {
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('the vendor MCP wrapper is exempt from the native-tool backstop, and nothing else is', async () => {
  // Found live: the tool loop worked and the backstop then rejected the turn
  // for using `call_mcp_tool`, which on this transport is how a DSH tool is
  // reached at all. Exempting it must not widen the hole for any other tool.
  for (const [toolName, shouldThrow] of [['call_mcp_tool', false], ['run_command', true]] as const) {
    const dir = await mkdtemp(join(tmpdir(), 'bridge-backstop-'))
    const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
    process.env[BRIDGE_SOCKET_DIR_ENV] = dir
    const child = controllableChild(3300)
    const ctx = {
      subprocess: {
        async resolveExecutable() { return '/resolved/agy' },
        spawn(spec: { argv: readonly string[] }) {
          if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
          if (spec.argv.includes('models')) {
            return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
          }
          return child.handle
        },
      },
    }
    const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
    try {
      const run = (async () => {
        const chunks: any[] = []
        for await (const chunk of adapter.stream({
          provider: 'antigravity-cli',
          model: 'gemini-3.7-flash-low',
          sessionId: 's-backstop',
          messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          tools: TOOLS,
        } as any)) chunks.push(chunk)
        return chunks
      })()
      await new Promise(r => setTimeout(r, 250))
      child.emitToolStep(toolName)
      child.finishTurn('answered')
      if (shouldThrow) {
        await assert.rejects(run, new RegExp(`blocked native tool\\(s\\): ${toolName}`))
      } else {
        const chunks = await run
        assert.equal(chunks.at(-1)?.reason?.kind, 'stop', `${toolName} must not trip the backstop`)
      }
    } finally {
      await adapter.dispose()
      if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
      else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
      await rm(dir, { recursive: true, force: true })
    }
  }
})
