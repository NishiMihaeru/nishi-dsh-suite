import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  antigravitySubagentPrompt,
  antigravitySubagentTextTask,
  startAntigravitySubagentRun,
} from '../src/antigravity-subagent.ts'

function createFakeChild(options: { resultText?: string; omitInit?: boolean } = {}) {
  const resultText = options.resultText ?? 'ANTIGRAVITY_SUBAGENT_OK'
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let stdinText = ''
  stdin.setEncoding('utf8')
  stdin.on('data', chunk => { stdinText += chunk })

  let resolveDone!: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolve => {
    resolveDone = resolve
  })
  let settled = false
  let terminateCalls = 0

  const handle = {
    pid: 4242,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stdout: undefined,
      stderr: { readFrom() { return { text: '' } } },
    },
    done,
    terminate() {
      terminateCalls += 1
      if (!settled) {
        settled = true
        stdout.end()
        resolveDone({ exitCode: 0, signal: null })
      }
    },
    async waitForExit() {
      await done
      return true
    },
  }

  queueMicrotask(() => {
    if (settled) return
    if (!options.omitInit) {
      stdout.write(`${JSON.stringify({ event: 'init', init: { cwd: '/repo', permission_mode: 'request-review' } })}\n`)
    }
    stdout.write(`${JSON.stringify({
      event: 'result',
      result: {
        status: 'SUCCESS',
        response: resultText,
      },
    })}\n`)
    stdout.end()
    settled = true
    resolveDone({ exitCode: 0, signal: null })
  })

  return {
    handle: handle as any,
    get stdinText() { return stdinText },
    get stdinEnded() { return stdin.writableEnded },
    get terminateCalls() { return terminateCalls },
  }
}

function createControlledFakeChild(resultText = 'ANTIGRAVITY_SUBAGENT_OK') {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let stdinText = ''
  stdin.setEncoding('utf8')
  stdin.on('data', chunk => { stdinText += chunk })

  let resolveDone!: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolve => {
    resolveDone = resolve
  })
  let settled = false
  let terminateCalls = 0

  const handle = {
    pid: 4243,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stdout: undefined,
      stderr: { readFrom() { return { text: '' } } },
    },
    done,
    terminate() {
      terminateCalls += 1
      if (!settled) {
        settled = true
        stdout.end()
        resolveDone({ exitCode: 0, signal: null })
      }
    },
    async waitForExit() {
      await done
      return true
    },
  }

  queueMicrotask(() => {
    if (!settled) {
      stdout.write(`${JSON.stringify({ event: 'init', init: { cwd: '/repo', permission_mode: 'request-review' } })}\n`)
    }
  })

  return {
    handle: handle as any,
    get stdinText() { return stdinText },
    get stdinEnded() { return stdin.writableEnded },
    releaseResult() {
      if (settled) return
      stdout.write(`${JSON.stringify({
        event: 'result',
        result: { status: 'SUCCESS', response: resultText },
      })}\n`)
      stdout.end()
      settled = true
      resolveDone({ exitCode: 0, signal: null })
    },
    get terminateCalls() { return terminateCalls },
  }
}

function request() {
  return {
    prompt: [{ type: 'text', text: 'Inspect package.json and report the package name.' }],
    parent: { session: { header: { cwd: '/repo' } } },
    signal: new AbortController().signal,
  } as any
}

function baseSpec(child: { handle: any }) {
  return {
    cwd: '/repo',
    executable: 'agy',
    env: {},
    model: 'gemini-3.7-flash-medium',
    effort: 'medium',
    turnTimeoutMs: 60_000,
    disposeGraceMs: 3_000,
    stderrMaxBytes: 64_000,
    projectMemory: {
      bootstrap: '# DSH Project Context\nSENTINEL=BLUE-COMET-2846',
      async read(topic: string) { return { topic, exists: false, content: null } },
    },
    async resolveExecutable(name: string) { return name },
    spawn() { return child.handle },
  } as any
}

test('Antigravity task validation accepts only non-empty text', () => {
  assert.throws(() => antigravitySubagentTextTask([]), /only text blocks/i)
  assert.throws(() => antigravitySubagentTextTask([{ type: 'image' } as any]), /only text blocks/i)
  assert.throws(() => antigravitySubagentTextTask([{ type: 'text', text: '   ' }]), /must not be empty/i)
  assert.equal(
    antigravitySubagentTextTask([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ]),
    'hello world',
  )
})

test('Antigravity prompt carries DSH memory snapshot as read-only context', () => {
  const prompt = antigravitySubagentPrompt('do work', '# DSH Project Context\nSENTINEL=BLUE-COMET-2846')
  assert.match(prompt, /SENTINEL=BLUE-COMET-2846/)
  assert.match(prompt, /read-only authoritative context/i)
  assert.match(prompt, /do not edit \.dsh\/memory/i)
  assert.match(prompt, /## Delegated task\ndo work/)
})

test('Antigravity run uses official agy stream-json in project cwd without permission bypass', async () => {
  const child = createFakeChild()
  let spawnSpec: any
  const spec = baseSpec(child)
  spec.spawn = (value: any) => {
    spawnSpec = value
    return child.handle
  }

  const run = await startAntigravitySubagentRun(request(), spec)
  const result = await run.result
  assert.equal(spawnSpec.cwd, '/repo')
  assert.ok(spawnSpec.argv.includes('agy'))
  assert.ok(spawnSpec.argv.includes('--input-format'))
  assert.ok(spawnSpec.argv.includes('stream-json'))
  assert.ok(spawnSpec.argv.includes('--output-format'))
  assert.ok(spawnSpec.argv.includes('--agent'))
  assert.ok(spawnSpec.argv.includes('dsh-subagent'))
  assert.ok(spawnSpec.argv.includes('--model'))
  assert.ok(spawnSpec.argv.includes('gemini-3.7-flash-medium'))
  assert.ok(spawnSpec.argv.includes('--effort'))
  assert.ok(spawnSpec.argv.includes('medium'))
  assert.equal(spawnSpec.argv.includes('--dangerously-skip-permissions'), false)
  assert.match(child.stdinText, /SENTINEL=BLUE-COMET-2846/)
  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(result.output, [{ type: 'text', text: 'ANTIGRAVITY_SUBAGENT_OK' }])

  await run.dispose()
  assert.ok(child.terminateCalls >= 1)
})

test('Antigravity keeps stream-json stdin open after init until the terminal result', async () => {
  const child = createControlledFakeChild()
  const run = await startAntigravitySubagentRun(request(), baseSpec(child))

  assert.match(child.stdinText, /Inspect package\.json/)
  assert.equal(child.stdinEnded, false, 'stdin must stay open after init while agy is still running')

  child.releaseResult()
  const result = await run.result
  assert.equal(result.stopReason, 'completed')

  await run.dispose()
})

test('Antigravity start rejects before publication when agy never emits init', async () => {
  const child = createFakeChild({ omitInit: true })
  await assert.rejects(
    startAntigravitySubagentRun(request(), baseSpec(child)),
    /failed to start official agy runtime/i,
  )
  assert.ok(child.terminateCalls >= 1)
})

test('Antigravity prompt carries workspace cwd and memory snapshot as read-only context', () => {
  const prompt = antigravitySubagentPrompt('do work', '# DSH Project Context\nSENTINEL=BLUE-COMET-2846', '/custom/workspace')
  assert.match(prompt, /SENTINEL=BLUE-COMET-2846/)
  assert.match(prompt, /\/custom\/workspace/)
  assert.match(prompt, /read-only authoritative context/i)
  assert.match(prompt, /do not edit \.dsh\/memory/i)
  assert.match(prompt, /## Delegated task\ndo work/)
})

test('ERROR with response is partial output but stopReason error', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let resolveDone!: (value: any) => void
  const done = new Promise(resolve => { resolveDone = resolve })
  const handle = {
    pid: 4244,
    stdin,
    stdout,
    stderr: undefined,
    collected: {
      stdout: undefined,
      stderr: { readFrom() { return { text: '' } } },
    },
    done,
    terminate() { resolveDone({ exitCode: 0, signal: null }) },
    async waitForExit() { await done; return true },
  }

  queueMicrotask(() => {
    stdout.write(`${JSON.stringify({ event: 'init', init: { cwd: '/repo', permission_mode: 'request-review' } })}\n`)
    stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'tool error occurred', response: 'PARTIAL_OUTPUT_TEXT' } })}\n`)
    stdout.end()
    resolveDone({ exitCode: 0, signal: null })
  })

  const spec = baseSpec({ handle })
  const run = await startAntigravitySubagentRun(request(), spec)
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.deepEqual(result.output, [{ type: 'text', text: 'PARTIAL_OUTPUT_TEXT' }])
  assert.equal(result.diagnostic, 'Product subagent failure (product: Antigravity CLI; stage: turn; category: provider-error)')
  await run.dispose()
})

test('CANCELED with response is partial output and stopReason aborted', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let resolveDone!: (value: any) => void
  const done = new Promise(resolve => { resolveDone = resolve })
  const handle = {
    pid: 4245,
    stdin,
    stdout,
    stderr: undefined,
    collected: { stdout: undefined, stderr: { readFrom() { return { text: '' } } } },
    done,
    terminate() { resolveDone({ exitCode: 0, signal: null }) },
    async waitForExit() { await done; return true },
  }

  queueMicrotask(() => {
    stdout.write(`${JSON.stringify({ event: 'init', init: { cwd: '/repo', permission_mode: 'request-review' } })}\n`)
    stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'CANCELED', response: 'PARTIAL_ON_CANCEL' } })}\n`)
    stdout.end()
    resolveDone({ exitCode: 0, signal: null })
  })

  const spec = baseSpec({ handle })
  const run = await startAntigravitySubagentRun(request(), spec)
  const result = await run.result
  assert.equal(result.stopReason, 'aborted')
  assert.deepEqual(result.output, [{ type: 'text', text: 'PARTIAL_ON_CANCEL' }])
  await run.dispose()
})

test('SUCCESS with empty response results in stopReason error', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let resolveDone!: (value: any) => void
  const done = new Promise(resolve => { resolveDone = resolve })
  const handle = {
    pid: 4246,
    stdin,
    stdout,
    stderr: undefined,
    collected: { stdout: undefined, stderr: { readFrom() { return { text: '' } } } },
    done,
    terminate() { resolveDone({ exitCode: 0, signal: null }) },
    async waitForExit() { await done; return true },
  }

  queueMicrotask(() => {
    stdout.write(`${JSON.stringify({ event: 'init', init: { cwd: '/repo', permission_mode: 'request-review' } })}\n`)
    stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '   ' } })}\n`)
    stdout.end()
    resolveDone({ exitCode: 0, signal: null })
  })

  const spec = baseSpec({ handle })
  const run = await startAntigravitySubagentRun(request(), spec)
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.deepEqual(result.output, [])
  assert.equal(result.diagnostic, 'Product subagent failure (product: Antigravity CLI; stage: turn; category: provider-error)')
  await run.dispose()
})
