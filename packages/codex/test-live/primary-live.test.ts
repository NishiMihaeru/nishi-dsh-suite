import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import * as codex from '../src/index.ts'
import { resolveCodexExecutable } from '../src/resolver.ts'

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
      })
      let resolveDone: any
      let rejectDone: any
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((res, rej) => {
        resolveDone = res
        rejectDone = rej
      })
      child.on('exit', (exitCode, signal) => {
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
          child.kill('SIGTERM')
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
  const providers = new Map<string, any>()
  const events = new Map<string, Function[]>()
  const sessions = new Map<string, any>()

  const ctx: any = {
    subprocess: createRealSubprocess(),
    llm: {
      adapters,
      registerAdapter(names: string[], adapter: any) {
        for (const name of names) {
          adapters.set(name, adapter)
        }
      },
    },
    subagents: {
      providers,
      registerProvider(provider: any) {
        providers.set(provider.name, provider)
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
    projectMemory: {
      async createSubagentContext(projectRoot: string) {
        return {
          projectRoot,
          renderedBootstrap: null,
          async readTopic(topic: string) {
            return { topic, exists: false, content: null }
          },
        }
      },
    },
    on(event: string, fn: Function) {
      const list = events.get(event) ?? []
      list.push(fn)
      events.set(event, list)
    },
    effect() {},
    logger: {
      warn(msg: string) {
        console.warn('WARN:', msg)
      },
    },
  }

  return { ctx, adapters, providers, sessions }
}

test('LIVE PROBE: Codex primary returns CODEX_PRIMARY_OK', async () => {
  const resolved = resolveCodexExecutable()
  assert.ok(resolved.executable, 'External Codex CLI resolved')

  const { ctx, adapters, sessions } = createLiveContext()

  await codex.apply(ctx, {
    executable: resolved.executable,
    turnTimeoutMs: 120_000,
  })

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
  await adapter.dispose()
})

test('LIVE PROBE: Codex subagent runs and returns CODEX_SUBAGENT_OK', async () => {
  const resolved = resolveCodexExecutable()
  assert.ok(resolved.executable, 'External Codex CLI resolved')

  const { ctx, providers } = createLiveContext()

  await codex.apply(ctx, {
    executable: resolved.executable,
    turnTimeoutMs: 120_000,
  })

  const subagentProvider = providers.get('codex')
  assert.ok(subagentProvider, 'codex subagent provider registered')

  const run = await subagentProvider.start({
    parent: {
      session: {
        header: {
          id: 'test-session-parent' as any,
          cwd: process.cwd(),
        },
      },
    },
    prompt: [{ type: 'text', text: 'Ответь ровно CODEX_SUBAGENT_OK' }],
    signal: AbortSignal.timeout(120_000),
  })

  assert.ok(run, 'Subagent run started')
  const result = await run.result
  console.log(`Subagent result: ${JSON.stringify(result)}`)
  assert.ok(
    result.output.some((b: any) => b.text?.includes('CODEX_SUBAGENT_OK')),
    `Expected CODEX_SUBAGENT_OK in result output: ${JSON.stringify(result)}`,
  )
})
