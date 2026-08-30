import assert from 'node:assert/strict'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'

/**
 * Regression net for `loadModels()` (antigravity-primary.ts:533), its JSON
 * path `collectModels()` (:122), and its text-fallback path
 * `parseModelRows()` (:142). Both are module-private, so every test drives
 * them only through the adapter's public `listModels()`/`resolveModel()`
 * seam with a fake `ctx.subprocess`, exactly as `packages/codex/test/*`
 * fakes vendor processes.
 *
 * A change queued right behind this suite removes the hardcoded
 * `(?:gemini|claude|gpt|oss)...` family filter. Every test marked
 * CHARACTERIZATION pins today's behavior specifically so that change can
 * flip the assertion instead of deleting the test.
 */

const config = {
  executable: 'agy',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 5_000,
  turnTimeoutMs: 5_000,
  disposeGraceMs: 1_000,
  stderrMaxBytes: 64_000,
}

/** A `runCollected`-shaped managed child: exits immediately with collected stdout/stderr. */
function collectedChild(stdout: string, stderr: string, exitCode: number | null = 0) {
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => done.resolve({ exitCode, signal: null }))
  return {
    pid: 1000,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: stdout, nextOffset: stdout.length, lossy: false } } },
      stderr: { readFrom() { return { text: stderr, nextOffset: stderr.length, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}

/**
 * `loadModels()` issues up to two sequential `runCollected` calls (the JSON
 * catalog, then the text fallback). `responses` is consumed in call order;
 * the last entry repeats if more calls happen than responses were given.
 */
function modelCatalogCtx(responses: ReadonlyArray<{ stdout: string; stderr: string; exitCode?: number | null }>) {
  let call = 0
  return {
    subprocess: {
      async resolveExecutable() { return '/resolved/agy' },
      spawn() {
        const response = responses[call] ?? responses[responses.length - 1]
        call += 1
        return collectedChild(response.stdout, response.stderr, response.exitCode ?? 0)
      },
    },
  } as any
}

// --- JSON catalog path (collectModels) ---------------------------------

test('a well-formed JSON catalog yields expected ids, including nested/array shapes', async () => {
  const catalog = {
    data: {
      models: [
        { id: 'claude-3-opus', display_name: 'Claude 3 Opus' },
        [{ slug: 'gemini-1.5-pro' }, { model_id: 'gpt-4o', name: 'GPT-4o' }],
      ],
    },
  }
  const ctx = modelCatalogCtx([{ stdout: JSON.stringify(catalog), stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id).sort(), ['claude-3-opus', 'gemini-1.5-pro', 'gpt-4o'].sort())
  assert.equal(models.find(m => m.id === 'claude-3-opus')?.name, 'Claude 3 Opus')
  assert.equal(models.find(m => m.id === 'gpt-4o')?.name, 'GPT-4o')
})

test('a non-string id candidate is rejected by collectModels', async () => {
  const catalog = [{ id: 12345 }, { id: 'claude-3-opus' }]
  const ctx = modelCatalogCtx([{ stdout: JSON.stringify(catalog), stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('an entry with none of the five id keys is skipped, even when it holds a family-shaped string', async () => {
  // collectModels only reads row.slug/id/model/model_id/modelId; a string
  // living under any other key is never treated as a model id candidate,
  // independent of whether it would pass the family filter.
  const catalog = [{ notAnIdKey: 'claude-3-haiku' }, { id: 'claude-3-opus' }]
  const ctx = modelCatalogCtx([{ stdout: JSON.stringify(catalog), stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('CHARACTERIZATION: a well-formed but out-of-family id is silently dropped by collectModels', async () => {
  // The family-filter removal this suite is guarding against is expected to
  // INVERT this assertion: 'mistral-large-2' should then be included.
  const catalog = [{ id: 'mistral-large-2' }, { id: 'claude-3-opus' }]
  const ctx = modelCatalogCtx([{ stdout: JSON.stringify(catalog), stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(
    models.map(m => m.id),
    ['claude-3-opus'],
    'mistral-large-2 is dropped today by the /(?:gemini|claude|gpt|oss).../ filter',
  )
})

test('CHARACTERIZATION: duplicate ids across different id keys collapse to the last-processed entry', async () => {
  const catalog = [
    { slug: 'claude-3-opus', display_name: 'First' },
    { model_id: 'claude-3-opus', display_name: 'Second' },
  ]
  const ctx = modelCatalogCtx([{ stdout: JSON.stringify(catalog), stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.equal(models.length, 1)
  assert.equal(models[0]?.name, 'Second', 'later entries overwrite earlier ones for the same id today (last writer wins)')
})

// --- Text fallback path (parseModelRows) --------------------------------
//
// In the text fallback the family regex is not merely a filter applied
// after extraction -- it IS the extraction mechanism. A line whose only
// model-shaped token is out-of-family never becomes a "candidate" that gets
// rejected; it simply never matches, so the whole line is invisible to the
// parser. Removing the family filter here therefore means widening/
// replacing the regex itself, not deleting a downstream filter step.

test('parseModelRows extracts ids from well-formed text catalog lines (via the JSON-path failure fallback)', async () => {
  const text = [
    'claude-3-opus   Claude 3 Opus (default)',
    'gemini-1.5-pro  Gemini 1.5 Pro',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 }, // JSON path fails -> forces the text fallback
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id).sort(), ['claude-3-opus', 'gemini-1.5-pro'])
})

test('a text line with no family-prefixed token at all is skipped by parseModelRows', async () => {
  const text = [
    'mistral-large-2  some out-of-family model line',
    'claude-3-opus    Claude 3 Opus',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('CHARACTERIZATION: an out-of-family model line yields nothing at all in the text fallback', async () => {
  // Unlike the JSON path, there is no "candidate that gets rejected" here:
  // the regex never matches, so the line contributes zero rows. Expected to
  // invert (the line starts contributing a row) once the family regex is
  // widened/replaced.
  const text = [
    'mistral-large-2   Mistral Large 2',
    'claude-3-opus     Claude 3 Opus',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('CHARACTERIZATION: duplicate ids across text lines collapse to the last-processed line', async () => {
  const text = [
    'claude-3-opus First description',
    'claude-3-opus Second description',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.equal(models.length, 1)
  assert.equal(models[0]?.name, 'claude-3-opus Second description', 'later lines overwrite earlier ones for the same id today')
})

// --- Zero-usable-models contract ----------------------------------------

test('zero usable models raises ANTIGRAVITY_PROTOCOL rather than returning an empty catalog', async () => {
  const ctx = modelCatalogCtx([
    { stdout: '[]', stderr: '', exitCode: 0 }, // structurally valid JSON, zero models
    { stdout: 'no models available', stderr: '', exitCode: 0 }, // text fallback also yields nothing parseable
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  await assert.rejects(adapter.listModels('antigravity-cli'), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_PROTOCOL')
    return true
  })
})

test('resolveModel resolves through the same catalog and falls back to the raw id when unknown', async () => {
  const catalog = [{ id: 'claude-3-opus', display_name: 'Claude 3 Opus' }]
  const ctx = modelCatalogCtx([{ stdout: JSON.stringify(catalog), stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const known = await adapter.resolveModel('antigravity-cli', 'claude-3-opus')
  assert.equal(known.name, 'Claude 3 Opus')

  const unknown = await adapter.resolveModel('antigravity-cli', 'not-in-catalog')
  assert.equal(unknown.name, 'not-in-catalog')
})
