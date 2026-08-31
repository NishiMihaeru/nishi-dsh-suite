import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test, { after } from 'node:test'
import * as codex from '../src/index.ts'
import { resolveCodexExecutable } from '../src/resolver.ts'

/**
 * Does `thread/inject_items` actually reach the model?
 *
 * The call has always succeeded and its effect has always been invisible:
 * neither `thread/read` nor `thread/resume` shows the injected items back, so
 * nothing had confirmed the model ever sees them. The adapter depends on it for
 * every message that follows a checkpoint, and the tool-result continuation fix
 * deliberately sends results twice -- once injected, once as turn input -- for
 * no reason other than this doubt (`ROADMAP.md` §7a, `HANDOFF.md`).
 *
 * The request here is shaped so that one value can ONLY have arrived by
 * injection. `prepareCodexHistory` splits a request at the last run of
 * user-authored messages: that run becomes `turn/start` input, everything
 * before it becomes `thread/inject_items`. A tool-result message is not
 * user-authored (`source.kind === 'tool'`), so a history ending
 * `... tool-result(SECRET), user(question)` puts the secret in the injected
 * half and the question in the input half, with no overlap. No checkpoint is
 * needed, and the belt-and-braces duplication that would defeat the probe --
 * `continuesFromToolResults` -- is not reached because the trailing user
 * message keeps `current` non-empty.
 *
 * Both halves of that claim are asserted rather than trusted: this suite sniffs
 * the JSON-RPC the adapter writes to the vendor and checks the secret appears
 * in an `inject_items` frame and NOT in the `turn/start` frame. Only then is
 * the model's answer evidence of anything.
 *
 * Run with: `pnpm test:live:inject-items`. One turn on one model.
 */

const SECRET = 'MARLIN-90714-VESPER'

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

/** Every JSON-RPC request the adapter wrote to the vendor, in order. */
const sent: { method: string; body: string }[] = []

function createSniffingSubprocess() {
  return {
    async resolveExecutable(name: string) { return name },
    spawn(spec: any) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      })
      liveChildren.add(child)
      let resolveDone: any
      let rejectDone: any
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((res, rej) => {
        resolveDone = res
        rejectDone = rej
      })
      child.on('exit', (exitCode, signal) => { liveChildren.delete(child); resolveDone({ exitCode, signal }) })
      child.on('error', err => { rejectDone(err) })

      // Wrap stdin so every frame the adapter sends is observable. This is the
      // only way to distinguish "the model read the injected item" from "the
      // value was in the turn input all along".
      const realStdin = child.stdin
      const stdin = new Proxy(realStdin as any, {
        get(target, prop, receiver) {
          if (prop === 'write') {
            return (chunk: any, ...rest: any[]) => {
              const body = String(chunk)
              for (const line of body.split('\n')) {
                if (!line.trim()) continue
                try {
                  const frame = JSON.parse(line)
                  if (typeof frame.method === 'string') sent.push({ method: frame.method, body: line })
                } catch { /* a partial frame is not our business */ }
              }
              return (target as any).write(chunk, ...rest)
            }
          }
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })

      return {
        pid: child.pid,
        stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        collected: { stderr: { readFrom() { return { text: '' } } } },
        done,
        terminate() {
          killTree(child.pid, 'SIGTERM')
          const escalation = setTimeout(() => killTree(child.pid, 'SIGKILL'), 2_000)
          escalation.unref?.()
          void done.then(() => clearTimeout(escalation), () => clearTimeout(escalation))
        },
        async waitForExit() { await done.catch(() => {}); return true },
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
      record(entry: any) { registeredProviders.set(entry.id, entry); return () => registeredProviders.delete(entry.id) },
      invalidate() {},
    },
    subprocess: createSniffingSubprocess(),
    llm: {
      adapters,
      registerAdapter(names: string[], adapter: any) {
        for (const name of names) adapters.set(name, adapter)
        return () => { for (const name of names) if (adapters.get(name) === adapter) adapters.delete(name) }
      },
    },
    sessions: { get(id: string) { return sessions.get(id) } },
    attachments: {
      async readImage() { throw new Error('No attachments in this probe') },
      async saveImage() { throw new Error('No attachments in this probe') },
    },
    on(event: string, fn: Function) {
      const list = events.get(event) ?? []
      list.push(fn)
      events.set(event, list)
    },
    effect(fn: () => unknown) { return fn() },
    logger: { warn(msg: string) { console.warn('WARN:', msg) } },
  }
  return { ctx, adapters, sessions }
}

test('LIVE PROBE: thread/inject_items reaches the model', async () => {
  const resolved = resolveCodexExecutable()
  const { ctx, adapters, sessions } = createLiveContext()

  await codex.apply(ctx, {
    env: { DSH_CODEX_EXECUTABLE: resolved.executable },
    turnTimeoutMs: 120_000,
  })

  const sessionId = `test-inject-items-${Date.now()}`
  sessions.set(sessionId, { header: { id: sessionId, cwd: process.cwd() } })

  const adapter = adapters.get('codex-app-server')
  const models = await adapter.listModels('codex-app-server')
  const model = models.some((m: any) => m.id === 'gpt-5.6-sol') ? 'gpt-5.6-sol' : models[0].id

  const messages = [
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Look up the vault code with the vault tool.' }],
    },
    {
      role: 'assistant',
      source: { kind: 'model', provider: 'antigravity-cli' },
      content: [{ type: 'tool-call', id: 'call_inject_1', name: 'vault', arguments: '{"which":"primary"}' }],
    },
    {
      role: 'user',
      source: { kind: 'tool', callId: 'call_inject_1' },
      content: [{
        type: 'tool-result',
        toolCallId: 'call_inject_1',
        content: [{ type: 'text', text: `vault code is ${SECRET}` }],
      }],
    },
    // A user-authored trailing message: this is what keeps the tool result in
    // the injected half instead of being duplicated into the turn input.
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'What exact vault code did the tool report? Reply with only that code.' }],
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
        name: 'vault',
        description: 'Report a vault code.',
        parameters: { which: { type: 'string', description: 'Which vault' } },
      }],
      signal: AbortSignal.timeout(120_000),
    })) {
      chunks.push(chunk)
    }

    const injected = sent.filter(frame => frame.method === 'thread/inject_items')
    const turnStarts = sent.filter(frame => frame.method === 'turn/start')
    console.log(`frames sent: ${sent.map(f => f.method).join(', ')}`)

    // Establish the experiment before reading its result.
    assert.equal(injected.length, 1, `expected exactly one inject_items call, got ${injected.length}`)
    assert.ok(
      injected[0]!.body.includes(SECRET),
      'the secret was not in the injected items, so this probe proves nothing',
    )
    assert.equal(turnStarts.length, 1, `expected exactly one turn/start, got ${turnStarts.length}`)
    assert.ok(
      !turnStarts[0]!.body.includes(SECRET),
      'the secret was ALSO in the turn input, so an answer would prove nothing',
    )

    const text = chunks
      .filter((c: any) => c.type === 'block-end' && c.block.type === 'text')
      .map((c: any) => c.block.text)
      .join('\n')
      .trim()
    console.log(`answer: ${JSON.stringify(text)}`)

    assert.ok(
      text.includes(SECRET),
      `thread/inject_items did NOT reach the model: the only path to this value was the injected item, and the answer was ${JSON.stringify(text)}`,
    )
  } finally {
    await adapter.dispose()
  }
})
