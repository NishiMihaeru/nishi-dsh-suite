import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { textTask, startCodexRun, disposeCodexChild } from '../src/run.ts'
import { CodexAppServerWire } from '../src/wire.ts'

function createFakeChild() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let settled = false
  let resolveDone!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  void done.catch(() => {})

  let terminateCalls = 0
  const terminate = () => {
    terminateCalls++
    if (!settled) {
      settled = true
      resolveDone({ exitCode: 0, signal: null })
    }
  }

  const handle = {
    pid: 9999,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done,
    terminate,
    async waitForExit() {
      await done.catch(() => {})
      return true
    },
  }

  return {
    handle: handle as any,
    stdin,
    stdout,
    settle(exitCode = 0) {
      if (!settled) {
        settled = true
        resolveDone({ exitCode, signal: null })
      }
    },
    fail(error: Error) {
      if (!settled) {
        settled = true
        rejectDone(error)
      }
    },
    get terminateCalls() {
      return terminateCalls
    },
  }
}

test('textTask validates non-empty text blocks and rejects non-text blocks', () => {
  assert.throws(
    () => textTask([]),
    /one-shot task must contain only text blocks/i,
  )

  assert.throws(
    () => textTask([{ type: 'image' } as any]),
    /one-shot task must contain only text blocks/i,
  )

  assert.throws(
    () => textTask([{ type: 'text', text: '   ' }]),
    /one-shot task must not be empty/i,
  )

  const result = textTask([
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'World' },
  ])
  assert.deepEqual(result, ['Hello ', 'World'])
})

test('lifecycle: wire protocol performs initialize, startThread, runTurn, and collects final answer', async () => {
  const child = createFakeChild()
  const wire = new CodexAppServerWire(child.stdout, child.stdin, 'never')

  let receivedInit = false
  let receivedInitialized = false
  let receivedStartThread = false
  let receivedTurnStart = false

  child.stdin.on('data', (chunk) => {
    const lines = chunk.toString('utf8').trim().split('\n')
    for (const line of lines) {
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.method === 'initialize') {
        receivedInit = true
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { serverInfo: { name: 'codex', version: '0.148.0-alpha.21' } },
        }) + '\n')
      } else if (msg.method === 'initialized') {
        receivedInitialized = true
      } else if (msg.method === 'thread/start') {
        receivedStartThread = true
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { thread: { id: 'th_001', ephemeral: true } },
        }) + '\n')
      } else if (msg.method === 'turn/start') {
        receivedTurnStart = true
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { turn: { id: 'turn_001', status: 'in_progress' } },
        }) + '\n')

        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/started',
          params: { threadId: 'th_001', turn: { id: 'turn_001' } },
        }) + '\n')

        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/completed',
          params: {
            threadId: 'th_001',
            turnId: 'turn_001',
            item: { type: 'agentMessage', phase: 'final_answer', text: 'Task completed successfully.' },
          },
        }) + '\n')

        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: {
            threadId: 'th_001',
            turn: { id: 'turn_001', status: 'completed' },
          },
        }) + '\n')
      }
    }
  })

  wire.start()
  const ac = new AbortController()

  await wire.initialize(ac.signal)
  assert.equal(receivedInit, true)
  assert.equal(receivedInitialized, true)

  await wire.startThread('/test/cwd', ac.signal)
  assert.equal(receivedStartThread, true)

  const result = await wire.runTurn(['Do task'], ac.signal)
  assert.equal(receivedTurnStart, true)
  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(result.output, [{ type: 'text', text: 'Task completed successfully.' }])

  wire.close()
})

test('lifecycle: wire unattended decisions decline command/file execution without user prompts', async () => {
  const child = createFakeChild()
  const wire = new CodexAppServerWire(child.stdout, child.stdin, 'never')

  let commandDecision: string | undefined
  let permissionsScope: string | undefined
  let elicitationAction: string | undefined

  child.stdin.on('data', (chunk) => {
    const lines = chunk.toString('utf8').trim().split('\n')
    for (const line of lines) {
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.method === 'initialize') {
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { serverInfo: { name: 'codex', version: '0.148.0-alpha.21' } },
        }) + '\n')
      } else if (msg.method === 'thread/start') {
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { thread: { id: 'th_002', ephemeral: true } },
        }) + '\n')
      } else if (msg.method === 'turn/start') {
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { turn: { id: 'turn_002', status: 'in_progress' } },
        }) + '\n')

        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_cmd',
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'th_002', turnId: 'turn_002', availableDecisions: ['cancel', 'decline'] },
        }) + '\n')
      } else if (msg.id === 'req_cmd') {
        commandDecision = msg.result?.decision
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_perm',
          method: 'item/permissions/requestApproval',
          params: { threadId: 'th_002', turnId: 'turn_002' },
        }) + '\n')
      } else if (msg.id === 'req_perm') {
        permissionsScope = msg.result?.scope
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_mcp',
          method: 'mcpServer/elicitation/request',
          params: { threadId: 'th_002', turnId: null },
        }) + '\n')
      } else if (msg.id === 'req_mcp') {
        elicitationAction = msg.result?.action

        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/completed',
          params: {
            threadId: 'th_002',
            turnId: 'turn_002',
            item: { type: 'agentMessage', phase: 'final_answer', text: 'Approval denied handled.' },
          },
        }) + '\n')
        child.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: {
            threadId: 'th_002',
            turn: { id: 'turn_002', status: 'completed' },
          },
        }) + '\n')
      }
    }
  })

  wire.start()
  const ac = new AbortController()
  await wire.initialize(ac.signal)
  await wire.startThread('/test/cwd', ac.signal)
  const result = await wire.runTurn(['Do task'], ac.signal)

  assert.equal(commandDecision, 'cancel')
  assert.equal(permissionsScope, 'turn')
  assert.equal(elicitationAction, 'decline')
  assert.equal(result.stopReason, 'completed')

  wire.close()
})

test('lifecycle: disposeCodexChild closes wire and terminates child process', async () => {
  const child = createFakeChild()
  const wire = new CodexAppServerWire(child.stdout, child.stdin, 'never')

  await disposeCodexChild(wire, child.handle)
  assert.equal(child.terminateCalls, 1)
})
