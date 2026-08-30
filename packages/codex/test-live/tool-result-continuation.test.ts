import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test, { after } from 'node:test'
import * as codex from '../src/index.ts'
import { resolveCodexExecutable } from '../src/resolver.ts'

/**
 * Every child this suite starts, so a probe that throws before its own
 * teardown still cannot leave the suite hanging. Codex spawns its own
 * subtree (an app-server plus a code-mode helper), and signalling only the
 * direct child leaves that subtree alive holding the event loop open --
 * which is exactly how this suite used to pass its assertions and then
 * never exit.
 */
const liveChildren = new Set<{ pid: number | undefined }>()

function killTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined || pid <= 0) return
  try {
    process.kill(-pid, signal)
  } catch {
    try { process.kill(pid, signal) } catch { /* already gone */ }
  }
}

after(async () => {
  for (const child of liveChildren) killTree(child.pid, 'SIGKILL')
  liveChildren.clear()
})

function createRealSubprocess() {
  return {
    async resolveExecutable(name: string) {
      return name
    },
    spawn(spec: any) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // Own process group, so terminate() can reach the whole subtree.
        detached: true,
      })
      liveChildren.add(child)
      let resolveDone: any
      let rejectDone: any
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((res, rej) => {
        resolveDone = res
        rejectDone = rej
      })
      child.on('exit', (exitCode, signal) => {
        liveChildren.delete(child)
        resolveDone({ exitCode, signal })
      })
      child.on('error', (err) => {
        rejectDone(err)
      })
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        collected: {
          stderr: {
            readFrom() {
              return { text: '' }
            },
          },
        },
        done,
        terminate() {
          killTree(child.pid, 'SIGTERM')
          // Escalate: the app-server subtree does not always go on SIGTERM.
          const escalation = setTimeout(() => killTree(child.pid, 'SIGKILL'), 2_000)
          escalation.unref?.()
          void done.then(() => clearTimeout(escalation), () => clearTimeout(escalation))
        },
        async waitForExit() {
          await done.catch(() => {})
          return true
        },
      }
    },
  }
}

function createLiveContext() {
  const adapters = new Map<string, any>()
  const registeredProviders = new Map<string, any>()
  const events = new Map<string, Function[]>()
  const sessions = new Map<string, any>()

  const ctx: any = {
    nishiProviders: {
      record(entry: any) {
        registeredProviders.set(entry.id, entry)
        return () => registeredProviders.delete(entry.id)
      },
      invalidate() {},
    },
    subprocess: createRealSubprocess(),
    llm: {
      adapters,
      registerAdapter(names: string[], adapter: any) {
        for (const name of names) adapters.set(name, adapter)
        return () => {
          for (const name of names) {
            if (adapters.get(name) === adapter) adapters.delete(name)
          }
        }
      },
    },
    sessions: {
      get(id: string) {
        return sessions.get(id)
      },
    },
    attachments: {
      async readImage() {
        throw new Error('No attachments in live text probe')
      },
      async saveImage() {
        throw new Error('No attachments in live text probe')
      },
    },
    on(event: string, fn: Function) {
      const list = events.get(event) ?? []
      list.push(fn)
      events.set(event, list)
    },
    effect(fn: () => unknown) {
      return fn()
    },
    logger: {
      warn(msg: string) {
        console.warn('WARN:', msg)
      },
    },
  }

  return { ctx, adapters, registeredProviders, sessions }
}


test('LIVE PROBE: a Codex turn whose pending tail is tool results continues instead of failing', async () => {
  const resolved = resolveCodexExecutable()
  const { ctx, adapters, sessions } = createLiveContext()

  await codex.apply(ctx, {
    env: { DSH_CODEX_EXECUTABLE: resolved.executable },
    turnTimeoutMs: 120_000,
  })

  const sessionId = `test-tool-result-continuation-${Date.now()}`
  sessions.set(sessionId, { header: { id: sessionId, cwd: process.cwd() } })

  const adapter = adapters.get('codex-app-server')
  const models = await adapter.listModels('codex-app-server')
  const model = models.some((m: any) => m.id === 'gpt-5.6-sol') ? 'gpt-5.6-sol' : models[0].id

  // Exactly the shape that used to throw: another route emitted the tool call,
  // its result came back, and Codex is asked to take the next step.
  const messages = [
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Ask the weather tool about Tbilisi, then report exactly what it said.' }],
    },
    {
      role: 'assistant',
      source: { kind: 'model', provider: 'antigravity-cli' },
      content: [{ type: 'tool-call', id: 'call_probe_1', name: 'weather', arguments: '{"city":"Tbilisi"}' }],
    },
    {
      role: 'user',
      source: { kind: 'tool', callId: 'call_probe_1' },
      content: [{
        type: 'tool-result',
        toolCallId: 'call_probe_1',
        content: [{ type: 'text', text: 'TOOL_RESULT_MARKER_42C' }],
      }],
    },
  ]

  const chunks: any[] = []
  try {
    for await (const chunk of adapter.stream({
      provider: 'codex-app-server',
      model,
      sessionId,
      messages,
      tools: [{
        name: 'weather',
        description: 'Report the weather for one city.',
        parameters: { city: { type: 'string', description: 'City name' } },
      }],
      signal: AbortSignal.timeout(120_000),
    })) {
      chunks.push(chunk)
    }
    const text = chunks
      .filter((c: any) => c.type === 'block-end' && c.block.type === 'text')
      .map((c: any) => c.block.text)
      .join('\n')
      .trim()
    console.log(`Continued-turn response: ${JSON.stringify(text)}`)
    assert.ok(text.length > 0, 'the continued turn must produce an answer')
    assert.ok(
      text.includes('TOOL_RESULT_MARKER_42C') || text.includes('42C'),
      `the model must have seen the tool result; got: ${text}`,
    )
  } finally {
    await adapter.dispose()
  }
})
