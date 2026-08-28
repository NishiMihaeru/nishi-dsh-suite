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

test('LIVE PROBE: Codex primary mounts without vendor subagents and returns CODEX_PRIMARY_OK', async () => {
  const resolved = resolveCodexExecutable()
  assert.ok(resolved.executable, 'External Codex CLI resolved')

  const { ctx, adapters, registeredProviders, sessions } = createLiveContext()
  assert.equal('subagents' in ctx, false, 'Codex primary must not require a vendor subagent service')

  await codex.apply(ctx, {
    env: { DSH_CODEX_EXECUTABLE: resolved.executable },
    turnTimeoutMs: 120_000,
  })

  assert.deepEqual([...registeredProviders.keys()], ['codex'])

  const sessionId = `test-primary-${Date.now()}`
  sessions.set(sessionId, {
    header: {
      id: sessionId,
      cwd: process.cwd(),
    },
  })

  const adapter = adapters.get('codex-app-server')
  assert.ok(adapter, 'codex-app-server adapter registered')

  const models = await adapter.listModels('codex-app-server')
  assert.ok(models.length > 0, 'Codex models available')

  const model = models.some((m: any) => m.id === 'gpt-5.6-sol') ? 'gpt-5.6-sol' : models[0].id
  console.log(`Using primary model: ${model}`)

  const chunks: any[] = []
  try {
    for await (const chunk of adapter.stream({
      provider: 'codex-app-server',
      model,
      sessionId,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Ответь ровно CODEX_PRIMARY_OK' }],
          source: { kind: 'user' },
        },
      ],
      signal: AbortSignal.timeout(120_000),
    })) {
      chunks.push(chunk)
    }

    const textBlocks = chunks.filter((c: any) => c.type === 'block-end' && c.block.type === 'text')
    const fullText = textBlocks.map((c: any) => c.block.text).join('\n').trim()
    console.log(`Codex Primary response: ${JSON.stringify(fullText)}`)
    assert.ok(fullText.includes('CODEX_PRIMARY_OK'), `Expected CODEX_PRIMARY_OK, got: ${fullText}`)
  } finally {
    await adapter.dispose()
  }
})
