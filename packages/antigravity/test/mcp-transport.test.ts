import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'
import {
  BRIDGE_SOCKET_DIR_ENV,
  BRIDGE_SOCKET_ENV,
  BRIDGE_TOKEN_ENV,
  decodeFrames,
  encodeFrame,
} from '../src/mcp-bridge.ts'
import { DEFAULT_ANTIGRAVITY_TRANSPORT } from '../src/antigravity-primary.ts'
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


/**
 * A fake vendor home, so these tests never read the developer's real vendor
 * configuration. The bridge precondition consults it, and a test whose result
 * depends on the machine it runs on is not a test.
 *
 * `store` selects which of the two files the vendor honours the grant is
 * written to -- `settings` is the documented one, `config` the one the
 * interactive CLI writes. Both are accepted by real `agy 1.1.24`, measured one
 * arm per file, so both have to be accepted here.
 */
async function withVendorHome<T>(
  grants: string[] | null,
  fn: () => Promise<T>,
  store: 'config' | 'settings' = 'config',
): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'vendor-home-'))
  if (grants !== null && store === 'config') {
    await mkdir(join(home, '.gemini', 'config'), { recursive: true })
    await writeFile(
      join(home, '.gemini', 'config', 'config.json'),
      JSON.stringify({ userSettings: { globalPermissionGrants: { allow: grants } } }),
      'utf8',
    )
  }
  if (grants !== null && store === 'settings') {
    await mkdir(join(home, '.gemini', 'antigravity-cli'), { recursive: true })
    await writeFile(
      join(home, '.gemini', 'antigravity-cli', 'settings.json'),
      JSON.stringify({ permissions: { allow: grants } }),
      'utf8',
    )
  }
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

/** The grant the mocked `agy mcp list` row below needs. */
const GRANTED = ['mcp(dshtools/*)']

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
  await withVendorHome(GRANTED, async () => {
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
    await first.catch(() => { /* no bridge server connects here; argv is the subject */ })
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
})

test('a vendor tool call becomes a DSH tool call, and its result reaches the still-open vendor turn', async () => {
  await withVendorHome(GRANTED, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-flow-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const child = controllableChild(3200)
  let turnEnv: Record<string, string> | undefined
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; env?: Record<string, string> }) {
        if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
        if (spec.argv.includes('models')) {
          return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
        }
        turnEnv = spec.env
        return child.handle
      },
    },
  }
  const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
  let server: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  try {
    const request = {
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'read /etc/hosts' }] }],
      tools: TOOLS,
    }

    // Step one: drive the stream, and stand in for the bridge server the
    // vendor would have launched -- claiming the child by its token, then asking
    // for a DSH tool.
    const firstChunks: any[] = []
    const firstStep = (async () => {
      for await (const chunk of adapter.stream(request as any)) firstChunks.push(chunk)
    })()

    await new Promise(r => setTimeout(r, 300))
    assert.ok(turnEnv, 'the adapter must spawn the child with environment')
    server = await attachServer(turnEnv)
    const claimed = server.frames.find(f => f.t === 'claimed')
    assert.ok(claimed, 'expected claimed frame')
    assert.deepEqual(claimed.tools.map((t: any) => t.name), ['read_file'], 'the child must be served this request\'s catalog')

    server.socket.write(encodeFrame({ t: 'call', id: 'bridge-1', name: 'read_file', arguments: { path: '/etc/hosts' } } as any))
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
    const result = server.frames.find(f => f.t === 'result')
    assert.ok(result, `the blocked call was never answered: ${JSON.stringify(server.frames)}`)
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
    server?.socket.destroy()
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
  })
})

test('the transport refuses to run when its bridge server is not registered with the vendor', async () => {
  await withVendorHome(GRANTED, async () => {
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
      /no MCP server registered with agy runs/,
    )
  } finally {
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
  })
})

test('the vendor MCP wrapper is exempt from the native-tool backstop, and nothing else is', async () => {
  // Found live: the tool loop worked and the backstop then rejected the turn
  // for using `call_mcp_tool`, which on this transport is how a DSH tool is
  // reached at all. Exempting it must not widen the hole for any other tool.
  for (const [toolName, shouldThrow] of [['call_mcp_tool', false], ['run_command', true]] as const) {
   await withVendorHome(GRANTED, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bridge-backstop-'))
    const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
    process.env[BRIDGE_SOCKET_DIR_ENV] = dir
    const child = controllableChild(3300)
    let turnEnv: Record<string, string> | undefined
    const ctx = {
      subprocess: {
        async resolveExecutable() { return '/resolved/agy' },
        spawn(spec: { argv: readonly string[]; env?: Record<string, string> }) {
          if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
          if (spec.argv.includes('models')) {
            return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
          }
          turnEnv = spec.env
          return child.handle
        },
      },
    }
    const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
    let server: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
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
      // Attach a bridge server, or the never-attached guard fires first and the
      // backstop is never reached.
      assert.ok(turnEnv, 'turn env must be captured')
      server = await attachServer(turnEnv)
      child.emitToolStep(toolName)
      child.finishTurn('answered')
      if (shouldThrow) {
        await assert.rejects(run, new RegExp(`blocked native tool\\(s\\): ${toolName}`))
      } else {
        const chunks = await run
        assert.equal(chunks.at(-1)?.reason?.kind, 'stop', `${toolName} must not trip the backstop`)
      }
    } finally {
      server?.socket.destroy()
      await adapter.dispose()
      if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
      else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
      await rm(dir, { recursive: true, force: true })
    }
   })
  }
})

test('mcp-bridge is the package default, and a config that says nothing gets it', () => {
  // Pinned deliberately: the default decides whether a fresh deployment needs
  // the one-time `agy mcp add`, so flipping it is a decision and not a tweak.
  assert.equal(DEFAULT_ANTIGRAVITY_TRANSPORT, 'mcp-bridge')
})

/** Drive one bridge turn against a scripted vendor, returning the rejection or chunks. */
async function runOneTurn(
  mcpListStdout: string,
  attach: boolean,
): Promise<{ chunks: any[]; error: unknown }> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-precond-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const child = controllableChild(3400)
  let turnEnv: Record<string, string> | undefined
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; env?: Record<string, string> }) {
        if (spec.argv.includes('list')) return collected(mcpListStdout)
        if (spec.argv.includes('models')) {
          return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
        }
        turnEnv = spec.env
        return child.handle
      },
    },
  }
  const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
  const chunks: any[] = []
  let error: unknown
  let server: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  try {
    const run = (async () => {
      for await (const chunk of adapter.stream({
        provider: 'antigravity-cli',
        model: 'gemini-3.7-flash-low',
        sessionId: 's-precond',
        messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: TOOLS,
      } as any)) chunks.push(chunk)
    })().catch(e => { error = e })
    await new Promise(r => setTimeout(r, 250))
    if (attach && turnEnv !== undefined) {
      server = await attachServer(turnEnv)
    }
    child.finishTurn('answered')
    await run
  } finally {
    server?.socket.destroy()
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
  return { chunks, error }
}

const ENABLED_ROW = 'dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n'

test('a registered but UNGRANTED bridge server refuses the turn instead of degrading silently', async () => {
  // The failure this prevents was measured on real agy 1.1.22: with the server
  // registered and no grant, the vendor launches it, the adapter claims it, and
  // the MCP tools are simply absent from the model's toolset. The model listed
  // its tools as `manage_task, schedule, send_message, finish` and answered with
  // an empty string. Nothing errors; the route looks healthy and is useless.
  await withVendorHome(['read_url(example.com)'], async () => {
    const { error } = await runOneTurn(ENABLED_ROW, true)
    assert.match(String((error as Error)?.message), /registered but not permitted/)
  })
})

test('a grant for the same server under any tool name is accepted', async () => {
  // A user narrowing the grant per tool has configured it deliberately; how
  // complete their list is, is their business and not a precondition failure.
  await withVendorHome(['mcp(dshtools/read_file)'], async () => {
    const { error } = await runOneTurn(ENABLED_ROW, true)
    assert.equal(error, undefined, `a per-tool grant must be accepted: ${String((error as Error)?.message)}`)
  })
  await withVendorHome(['mcp(*)'], async () => {
    const { error } = await runOneTurn(ENABLED_ROW, true)
    assert.equal(error, undefined, `a blanket grant must be accepted: ${String((error as Error)?.message)}`)
  })
})

/**
 * The documented store is `permissions.allow` in
 * `~/.gemini/antigravity-cli/settings.json`, and it is what the vendor's own
 * headless denial message tells a user to edit. The undocumented
 * `globalPermissionGrants` store the interactive CLI writes was the only one
 * this package used to read, so a user who followed the vendor's own
 * documentation had a route refused that the vendor would have run. Probed on
 * real `agy 1.1.24`: both stores are honoured, and with the grant in neither
 * the same call is denied. See `docs/verification/agy-cli-contract.md`.
 */
test('a grant in the documented settings.json store alone is accepted', async () => {
  await withVendorHome(GRANTED, async () => {
    const { error } = await runOneTurn(ENABLED_ROW, true)
    assert.equal(error, undefined, `the documented store must be read: ${String((error as Error)?.message)}`)
  }, 'settings')
})

test('the setup instructions name the documented store', async () => {
  await withVendorHome([], async () => {
    const { error } = await runOneTurn(ENABLED_ROW, true)
    assert.ok(error instanceof LlmError)
    assert.match(error.message, /permissions\.allow/)
    assert.match(error.message, /antigravity-cli\/settings\.json/)
  })
})

test('an unreadable vendor config is treated as unknown, never as a missing grant', async () => {
  // The file belongs to the vendor and the user. Turning a layout change into a
  // dead route would be worse than the gap the check closes.
  await withVendorHome(null, async () => {
    const { error } = await runOneTurn(ENABLED_ROW, true)
    assert.equal(error, undefined, `an absent config must not block: ${String((error as Error)?.message)}`)
  })
})

test('a disabled bridge server refuses the turn and says how to enable it', async () => {
  await withVendorHome(GRANTED, async () => {
    const { error } = await runOneTurn('dshtools stdio disabled node /x/lib/mcp-bridge-server.js\n', true)
    assert.match(String((error as Error)?.message), /registered but disabled/)
    assert.match(String((error as Error)?.message), /agy mcp enable dshtools/)
  })
})

test('a turn whose bridge server never connected fails loudly rather than answering toolless', async () => {
  // Everything the precondition can see is fine here; the vendor simply never
  // launched the server. "The model made no tool call" is ambiguous, but "no
  // server ever attached" is not.
  await withVendorHome(GRANTED, async () => {
    const { error } = await runOneTurn(ENABLED_ROW, false)
    assert.match(String((error as Error)?.message), /never launched a bridge server/)
  })
})


/** A fake bridge server on the adapter's socket, claiming one vendor child. */
async function attachServer(env: Record<string, string | undefined>) {
  const socketPath = env[BRIDGE_SOCKET_ENV]
  const token = env[BRIDGE_TOKEN_ENV]
  assert.ok(socketPath, 'adapter must pass the bridge socket path in the environment')
  assert.ok(token, 'adapter must pass the bridge token in the environment')
  const socket = connect(socketPath)
  socket.setEncoding('utf8')
  const frames: any[] = []
  let buffer = ''
  socket.on('data', c => {
    buffer += c
    const decoded = decodeFrames(buffer)
    buffer = decoded.rest
    for (const frame of decoded.frames) frames.push(frame)
  })
  socket.on('error', () => {})
  socket.write(encodeFrame({ t: 'hello', token }))
  await new Promise(r => setTimeout(r, 150))
  return { socket, frames }
}

/**
 * Drive one step to the point where the vendor turn is suspended on a tool
 * call, and hand back everything the second step needs.
 */
async function suspendOnToolCall(
  adapter: AntigravityCliAdapter,
  request: unknown,
  getTurnEnv: () => Record<string, string> | undefined,
) {
  const chunks: any[] = []
  const step = (async () => {
    for await (const chunk of adapter.stream(request as any)) chunks.push(chunk)
  })()
  await new Promise(r => setTimeout(r, 300))
  const env = getTurnEnv()
  assert.ok(env, 'expected turn process to have spawned with environment')
  const server = await attachServer(env)
  server.socket.write(encodeFrame({ t: 'call', id: 'bridge-1', name: 'read_file', arguments: { path: '/etc/hosts' } } as any))
  await step
  const toolCall = chunks.find(c => c.type === 'block-end' && c.block?.type === 'tool-call')
  assert.ok(toolCall, `expected a suspended tool call, got ${JSON.stringify(chunks)}`)
  return { server, toolCall }
}

/**
 * The window this transport uniquely opens, and used to leave unguarded.
 *
 * A suspended turn spans DSH steps, and everything that rewrites history --
 * rewind, compaction, repair -- lands in exactly that gap. Answering the
 * blocked call across such a rewrite resumes a vendor conversation against a
 * history that no longer exists, and nothing downstream can see it happen: the
 * model reads a plausible tool result and keeps going. The schema path rebuilds
 * on a divergent prefix at every step; this path skipped the test for the whole
 * suspension.
 */
test('a history rewritten while a turn is suspended rebuilds instead of answering the blocked call', async () => {
  await withVendorHome(GRANTED, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-diverge-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const first = controllableChild(3300)
  const second = controllableChild(3301)
  const turnChildren = [first, second]
  const turnEnvs: Record<string, string>[] = []
  let spawned = 0
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; env?: Record<string, string> }) {
        if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
        if (spec.argv.includes('models')) {
          return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
        }
        if (spec.env) turnEnvs.push(spec.env)
        const child = turnChildren[Math.min(spawned, turnChildren.length - 1)]!
        spawned += 1
        return child.handle
      },
    },
  }
  const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
  let serverOne: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  let serverTwo: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  try {
    const request = {
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'read /etc/hosts' }] }],
      tools: TOOLS,
    }
    const suspended = await suspendOnToolCall(adapter, request, () => turnEnvs[0])
    serverOne = suspended.server
    assert.equal(spawned, 1)

    // The rewrite: m1 keeps its id and changes its content, which is what a
    // repaired or edited history looks like from the adapter's side.
    const secondChunks: any[] = []
    const secondStep = (async () => {
      for await (const chunk of adapter.stream({
        ...request,
        messages: [
          { id: 'm1', role: 'user', content: [{ type: 'text', text: 'actually, read /etc/passwd' }] },
          { id: 'm2', role: 'assistant', content: [{ type: 'tool-call', id: suspended.toolCall.block.id, name: 'read_file', arguments: suspended.toolCall.block.arguments }] },
          { id: 'm3', role: 'user', content: [{ type: 'tool-result', toolCallId: suspended.toolCall.block.id, content: [{ type: 'text', text: '127.0.0.1 localhost' }] }] },
        ],
      } as any)) secondChunks.push(chunk)
    })()

    await new Promise(r => setTimeout(r, 300))
    // Asserted before the step is allowed to finish, and deliberately: without
    // the rebuild the adapter answers the stale child instead, and the step
    // then hangs on a conversation nobody is driving until the turn timeout.
    // A five-second timeout names nothing; this names the defect.
    assert.equal(spawned, 2, 'a divergent history must rebuild the vendor conversation')
    assert.equal(
      serverOne.frames.some(f => f.t === 'result'),
      false,
      'the blocked call must never be answered across a rewritten history',
    )

    assert.ok(turnEnvs[1], 'second child env must be captured')
    serverTwo = await attachServer(turnEnvs[1])
    second.finishTurn('reading /etc/passwd now')
    await secondStep

    // Rebuilt, not continued: the new child is told the whole history,
    // including the rewrite the old conversation never heard.
    const envelope = second.written.join('')
    assert.match(envelope, /actually, read \/etc\/passwd/)
    const text = secondChunks.find(c => c.type === 'block-end' && c.block?.type === 'text')
    assert.equal(text?.block.text, 'reading /etc/passwd now')
  } finally {
    serverOne?.socket.destroy()
    serverTwo?.socket.destroy()
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
  })
})

/**
 * The other half of the same guard: agreement is checked, growth is not.
 *
 * A step that repeats the previous request has an intact prefix and no tool
 * result in it. Treating that as divergence would rebuild the conversation and
 * hide a caller that lost track of its own turn boundaries, so it must still
 * fail by name.
 */
test('a repeated request on a suspended turn still fails by name rather than rebuilding', async () => {
  await withVendorHome(GRANTED, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-repeat-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const child = controllableChild(3400)
  let turnEnv: Record<string, string> | undefined
  let spawned = 0
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; env?: Record<string, string> }) {
        if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
        if (spec.argv.includes('models')) {
          return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
        }
        turnEnv = spec.env
        spawned += 1
        return child.handle
      },
    },
  }
  const adapter = new AntigravityCliAdapter(ctx as any, baseConfig)
  let server: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  try {
    const request = {
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'read /etc/hosts' }] }],
      tools: TOOLS,
    }
    const suspended = await suspendOnToolCall(adapter, request, () => turnEnv)
    server = suspended.server
    assert.equal(spawned, 1)

    await assert.rejects(
      async () => {
        for await (const _ of adapter.stream(request as any)) { /* must not get here */ }
      },
      /no DSH result for tool call/,
    )
  } finally {
    server?.socket.destroy()
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
  })
})


/**
 * One adapter over a list of controllable vendor children, for the two tests
 * below.
 *
 * Both drive the same shape -- suspend on a tool call, break the turn under
 * the adapter, answer -- and differ only in HOW the turn ends, so the setup is
 * shared rather than copied a third and fourth time.
 */
function childAdapter(...children: ReturnType<typeof controllableChild>[]) {
  const turnEnvs: Record<string, string>[] = []
  let spawned = 0
  const ctx = {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn(spec: { argv: readonly string[]; env?: Record<string, string> }) {
        if (spec.argv.includes('list')) return collected('dshtools stdio enabled node /x/lib/mcp-bridge-server.js\n')
        if (spec.argv.includes('models')) {
          return collected(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: CATALOG }) + '\n')
        }
        if (spec.env) turnEnvs.push(spec.env)
        const child = children[Math.min(spawned, children.length - 1)]!
        spawned += 1
        return child.handle
      },
    },
  }
  return {
    adapter: new AntigravityCliAdapter(ctx as any, baseConfig),
    getTurnEnv: () => turnEnvs[0],
    turnEnvs,
    spawnCount: () => spawned,
  }
}

/** The history a well-behaved second step carries: the call, then its result. */
function answeredHistory(callId: string, args: unknown) {
  return [
    { id: 'm1', role: 'user', content: [{ type: 'text', text: 'read /etc/hosts' }] },
    { id: 'm2', role: 'assistant', content: [{ type: 'tool-call', id: callId, name: 'read_file', arguments: args }] },
    { id: 'm3', role: 'user', content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: '127.0.0.1 localhost' }] }] },
  ]
}

/**
 * The one bridge assumption that would otherwise break in silence.
 *
 * Three measured `agy` behaviours hold this transport up. Two of them -- that
 * the environment reaches the MCP child verbatim, and that `agy mcp add --env`
 * merges with it rather than replacing it -- fail as a server that never
 * claims its channel, which `attached() === false` already refuses by name.
 * The third, that a blocked MCP call holds the vendor turn open, fails
 * differently: the model answers from whatever it was handed in place of the
 * result, the race in `settleMcpStep` sees an ordinary finished turn, and a
 * whole turn of reasoning built on a result that never arrived is recorded as
 * a normal completion.
 *
 * Nothing in a version string says this happened, which is why the assumption
 * is asserted where it is observable rather than gated on a version range.
 */
test('a vendor turn that ended while still blocked fails loudly instead of recording a toolless answer', async () => {
  await withVendorHome(GRANTED, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-abandoned-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const child = controllableChild(3500)
  const { adapter, getTurnEnv, spawnCount } = childAdapter(child)
  let server: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  try {
    const request = {
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'read /etc/hosts' }] }],
      tools: TOOLS,
    }
    const suspended = await suspendOnToolCall(adapter, request, getTurnEnv)
    server = suspended.server
    assert.equal(spawnCount(), 1)

    // The vendor break itself, in one line: the turn completes SUCCESSFULLY
    // while its MCP call is still outstanding. Real `agy 1.1.22` cannot do
    // this, which is the whole reason the transport was adopted.
    child.finishTurn('I could not read the file, so here is a guess.')
    await new Promise(r => setTimeout(r, 150))

    await assert.rejects(
      async () => {
        for await (const _ of adapter.stream({
          ...request,
          messages: answeredHistory(suspended.toolCall.block.id, suspended.toolCall.block.arguments),
        } as any)) { /* must not get here */ }
      },
      /ended while still blocked on DSH tool call/,
    )
    // The answer the model never waited for must not be written either: a
    // server released into a finished turn would hand it to whatever turn came
    // next on the same child.
    assert.equal(
      server.frames.some(f => f.t === 'result'),
      false,
      'a turn that already ended must not be answered as though it were listening',
    )
  } finally {
    server?.socket.destroy()
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
  })
})

/**
 * The other half, and the reason the new check tests SUCCESS rather than mere
 * settlement.
 *
 * Every turn failure runs through `AgyTurnProcess.fail`, which marks the child
 * dead, so a turn that died under the adapter is swept into a rebuild by the
 * aliveness check long before the blocked-call path is reached. Reporting that
 * as a vendor-contract break would fire on every dead child and mean nothing.
 */
test('a vendor child that died while its turn was suspended rebuilds rather than reporting a contract break', async () => {
  await withVendorHome(GRANTED, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-died-'))
  const previous = process.env[BRIDGE_SOCKET_DIR_ENV]
  process.env[BRIDGE_SOCKET_DIR_ENV] = dir
  const first = controllableChild(3600)
  const second = controllableChild(3601)
  const { adapter, getTurnEnv, turnEnvs, spawnCount } = childAdapter(first, second)
  let serverOne: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  let serverTwo: { socket: ReturnType<typeof connect>; frames: any[] } | undefined
  try {
    const request = {
      provider: 'antigravity-cli',
      model: 'gemini-3.7-flash-low',
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'read /etc/hosts' }] }],
      tools: TOOLS,
    }
    const suspended = await suspendOnToolCall(adapter, request, getTurnEnv)
    serverOne = suspended.server
    assert.equal(spawnCount(), 1)

    // The child dies mid-suspension: the turn settles, but as a failure, and
    // the child is dead with it.
    first.handle.terminate()
    await new Promise(r => setTimeout(r, 150))

    const chunks: any[] = []
    const step = (async () => {
      for await (const chunk of adapter.stream({
        ...request,
        messages: answeredHistory(suspended.toolCall.block.id, suspended.toolCall.block.arguments),
      } as any)) chunks.push(chunk)
    })()
    await new Promise(r => setTimeout(r, 300))
    assert.equal(spawnCount(), 2, 'a dead child must rebuild the vendor conversation')

    assert.ok(turnEnvs[1], 'second child env must be captured')
    serverTwo = await attachServer(turnEnvs[1])
    second.finishTurn('127.0.0.1 localhost')
    await step

    const text = chunks.find(c => c.type === 'block-end' && c.block?.type === 'text')
    assert.equal(text?.block.text, '127.0.0.1 localhost')
  } finally {
    serverOne?.socket.destroy()
    serverTwo?.socket.destroy()
    await adapter.dispose()
    if (previous === undefined) delete process.env[BRIDGE_SOCKET_DIR_ENV]
    else process.env[BRIDGE_SOCKET_DIR_ENV] = previous
    await rm(dir, { recursive: true, force: true })
  }
  })
})
