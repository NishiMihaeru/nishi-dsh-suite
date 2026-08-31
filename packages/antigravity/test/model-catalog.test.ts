import assert from 'node:assert/strict'
import test from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AntigravityCliAdapter } from '../src/antigravity-primary.ts'

/**
 * Regression net for `loadModels()` (antigravity-primary.ts:~534), its JSON
 * envelope path `parseAgyEnvelope()`, and the shared entry parser
 * `parseCatalogEntries()` used by both the envelope's `response` string and
 * the plain-text `agy models` fallback. All are module-private, so every
 * test drives them only through the adapter's public
 * `listModels()`/`resolveModel()` seam with a fake `ctx.subprocess`, exactly
 * as `packages/codex/test/*` fakes vendor processes.
 *
 * This suite replaces an earlier one that pinned two wrong assumptions
 * about the real `agy 1.1.22` vendor CLI:
 *
 *   1. That `--output-format json models` emits a structured catalog object
 *      with `slug`/`id`/`model`/`model_id`/`modelId` keys somewhere in it.
 *      It does not -- it emits the *same tab-separated text* as the
 *      non-JSON path, as a string under `response`, wrapped in a
 *      `{conversation_id, status, response}` envelope. The old
 *      object-recursion catalog parser never matched anything real and has
 *      been deleted, not merely relaxed.
 *   2. That model ids are constrained to a `gemini|claude|gpt|oss` family
 *      prefix. Real ids carry no such constraint, and the hardcoded family
 *      regex has been removed from both parsing paths. Tests that pinned
 *      that filter are marked CHARACTERIZATION below and are inverted here
 *      (the ids they used to reject are now accepted) rather than deleted.
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
 * envelope, then the text fallback). `responses` is consumed in call order;
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

/** Builds the real `agy` stdout shape: a progress line, then the JSON envelope line. */
function agyJsonModelsStdout(envelope: Record<string, unknown>): string {
  return `Fetching available models...\n${JSON.stringify(envelope)}\n`
}

// --- JSON envelope path (parseAgyEnvelope + parseCatalogEntries) -------

test('the real captured envelope shape is parsed: progress line skipped, tab-separated response parsed', async () => {
  // Envelope parsing extracts tab-separated response lines after progress line.
  const stdout = 'Fetching available models...\n'
    + '{"conversation_id":"","status":"SUCCESS","response":"claude-3-5-sonnet\\tClaude 3.5 Sonnet\\ngpt-4o\\tGPT-4o"}\n'
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id).sort(), ['claude-3-5-sonnet', 'gpt-4o'])
  assert.equal(models.find(m => m.id === 'claude-3-5-sonnet')?.name, 'Claude 3.5 Sonnet')
})

test('the envelope path accepts ids from any vendor family, with no hardcoded prefix list', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: [
      'claude-4-opus\tClaude 4 Opus',
      'gpt-5-codex\tGPT-5 Codex',
      'mistral-large-2\tMistral Large 2',
    ].join('\n'),
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(
    models.map(m => m.id).sort(),
    ['claude-4-opus', 'gpt-5-codex', 'mistral-large-2'],
  )
})

test('CHARACTERIZATION (inverted): a well-formed but out-of-family id is now accepted by the envelope path', async () => {
  // Previously the hardcoded /(?:gemini|claude|gpt|oss).../ filter silently
  // dropped 'mistral-large-2'. That filter is gone; it is now included.
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: ['mistral-large-2\tMistral Large 2', 'claude-3-opus\tClaude 3 Opus'].join('\n'),
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id).sort(), ['claude-3-opus', 'mistral-large-2'])
})

test('CHARACTERIZATION (inverted): duplicate ids in the envelope response collapse to the last-processed line', async () => {
  // Deliberate choice: last-writer-wins, same as the pre-existing behavior
  // of both catalog paths this replaces (see parseCatalogEntries' doc
  // comment). A duplicate id is a vendor bug either way; this is not an
  // attempt to reconcile it, just the deterministic outcome of a forward
  // pass into a Map.
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: ['claude-3-opus\tFirst', 'claude-3-opus\tSecond'].join('\n'),
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.equal(models.length, 1)
  assert.equal(models[0]?.name, 'Second', 'later lines overwrite earlier ones for the same id (last-writer-wins)')
})

test('a non-SUCCESS envelope status fails loudly instead of falling back to the text path', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'ERROR',
    error: 'quota exceeded for /home/secret-user/private/path',
  })
  const ctx = modelCatalogCtx([
    { stdout, stderr: '', exitCode: 0 },
    // Should never be reached: a definitive status signal is authoritative.
    { stdout: 'claude-3-opus\tClaude 3 Opus', stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  await assert.rejects(adapter.listModels('antigravity-cli'), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_CLI')
    // The status enum is a safe, DSH-side value and is named directly; the
    // envelope's own `error` string is vendor-authored free text and must go
    // through VendorFailure like every other vendor output in this package.
    assert.match(error.message, /status ERROR/)
    assert.doesNotMatch(error.message, /quota exceeded/)
    assert.doesNotMatch(error.message, /secret-user/)
    return true
  })
})

test('an envelope with no parseable JSON object falls back to the text path', async () => {
  const ctx = modelCatalogCtx([
    { stdout: 'Fetching available models...\nnot json at all\n', stderr: '', exitCode: 0 },
    { stdout: 'claude-3-opus\tClaude 3 Opus', stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

// --- Shared entry parser (parseCatalogEntries) --------------------------
//
// Exercised here via the plain-text `agy models` fallback, which uses the
// identical parser as the envelope's `response` field.

test('parseCatalogEntries extracts id/name pairs from well-formed tab-separated lines (via the JSON-path failure fallback)', async () => {
  const text = [
    'claude-3-opus\tClaude 3 Opus (default)',
    'gemini-1.5-pro\tGemini 1.5 Pro',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 }, // JSON path fails -> forces the text fallback
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id).sort(), ['claude-3-opus', 'gemini-1.5-pro'])
  assert.equal(models.find(m => m.id === 'claude-3-opus')?.name, 'Claude 3 Opus (default)')
})

test('CHARACTERIZATION (inverted): an out-of-family model line is now accepted by the text fallback', async () => {
  // Previously the family regex WAS the extraction mechanism: a line whose
  // only model-shaped token was out-of-family never matched at all, so it
  // contributed zero rows. That regex has been replaced entirely by tab
  // presence + id-shape checks, so this line is now a normal entry.
  const text = [
    'mistral-large-2\tMistral Large 2',
    'claude-3-opus\tClaude 3 Opus',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id).sort(), ['claude-3-opus', 'mistral-large-2'])
})

test('CHARACTERIZATION (inverted): duplicate ids across text lines collapse to the last-processed line', async () => {
  const text = [
    'claude-3-opus\tFirst description',
    'claude-3-opus\tSecond description',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.equal(models.length, 1)
  assert.equal(models[0]?.name, 'Second description', 'later lines overwrite earlier ones for the same id today')
})

test('the "Fetching available models..." progress line is skipped without special-casing its wording', async () => {
  const text = 'Fetching available models...\nclaude-3-opus\tClaude 3 Opus'
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('a line with no tab at all is skipped, regardless of its wording', async () => {
  const text = [
    'this line has no tab character in it',
    'claude-3-opus\tClaude 3 Opus',
  ].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('an entry with an empty id is rejected', async () => {
  const text = ['\tNo id here', 'claude-3-opus\tClaude 3 Opus'].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('an entry whose id contains internal whitespace is rejected', async () => {
  const text = ['claude 3 opus\tSpaced Id', 'claude-3-opus\tClaude 3 Opus'].join('\n')
  const ctx = modelCatalogCtx([
    { stdout: '', stderr: '', exitCode: 1 },
    { stdout: text, stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

// --- Zero-usable-models contract ----------------------------------------

test('zero usable models raises ANTIGRAVITY_PROTOCOL rather than returning an empty catalog', async () => {
  const ctx = modelCatalogCtx([
    { stdout: 'Fetching available models...\nnot an envelope', stderr: '', exitCode: 0 }, // JSON path yields nothing
    { stdout: 'no models available', stderr: '', exitCode: 0 }, // text fallback also yields nothing parseable
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  await assert.rejects(adapter.listModels('antigravity-cli'), (error: unknown) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'ANTIGRAVITY_PROTOCOL')
    return true
  })
})

test('an envelope that parses with SUCCESS but zero usable entries falls back to the text path', async () => {
  const stdout = agyJsonModelsStdout({ conversation_id: '', status: 'SUCCESS', response: '' })
  const ctx = modelCatalogCtx([
    { stdout, stderr: '', exitCode: 0 },
    { stdout: 'claude-3-opus\tClaude 3 Opus', stderr: '', exitCode: 0 },
  ])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')

  assert.deepEqual(models.map(m => m.id), ['claude-3-opus'])
})

test('resolveModel resolves through the same catalog and falls back to the raw id when unknown', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: 'claude-3-opus\tClaude 3 Opus',
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const known = await adapter.resolveModel('antigravity-cli', 'claude-3-opus')
  assert.equal(known.name, 'Claude 3 Opus')

  const unknown = await adapter.resolveModel('antigravity-cli', 'not-in-catalog')
  assert.equal(unknown.name, 'not-in-catalog')
})

// --- Reasoning variants grouping and resolution tests -------------------

test('vendor envelope with gemini-3.7-flash-low/medium/high lists single gemini-3.7-flash with name "Gemini 3.7 Flash" and no suffixed IDs', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: [
      'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
    ].join('\n'),
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')
  const modelIds = models.map(m => String(m.id))

  assert.deepEqual(modelIds, ['gemini-3.7-flash'])
  const model = models.find(m => String(m.id) === 'gemini-3.7-flash')
  assert.equal(model?.name, 'Gemini 3.7 Flash')
  assert.ok(!modelIds.includes('gemini-3.7-flash-low'))
  assert.ok(!modelIds.includes('gemini-3.7-flash-medium'))
  assert.ok(!modelIds.includes('gemini-3.7-flash-high'))
})

test('resolveModel(base) returns reasoning efforts ids [low, medium, high] and defaultEffort high', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: [
      'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
    ].join('\n'),
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const resolved = await adapter.resolveModel('antigravity-cli', 'gemini-3.7-flash')
  assert.equal(String(resolved.id), 'gemini-3.7-flash')
  assert.ok(resolved.reasoning, 'reasoning should be present')
  const effortIds = (resolved.reasoning?.efforts ?? []).map((e: any) => String(e.id ?? e))
  assert.deepEqual(effortIds, ['low', 'medium', 'high'])
  assert.equal(String(resolved.reasoning?.defaultEffort), 'high')
})

test('resolveModel(legacy medium id) succeeds, preserves requested id, and sets defaultEffort to medium', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: [
      'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
    ].join('\n'),
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const resolved = await adapter.resolveModel('antigravity-cli', 'gemini-3.7-flash-medium')
  assert.equal(String(resolved.id), 'gemini-3.7-flash-medium')
  assert.ok(resolved.reasoning, 'reasoning should be present')
  assert.equal(String(resolved.reasoning?.defaultEffort), 'medium')
})

test('single model id ending in -high without sibling variants remains unchanged and without reasoning', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: 'custom-model-high\tCustom Model High',
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')
  assert.deepEqual(models.map(m => String(m.id)), ['custom-model-high'])
  assert.equal(models[0]?.name, 'Custom Model High')
  assert.equal(models[0]?.reasoning, undefined)

  const resolved = await adapter.resolveModel('antigravity-cli', 'custom-model-high')
  assert.equal(String(resolved.id), 'custom-model-high')
  assert.equal(resolved.reasoning, undefined)
})

test('unrelated normal model remains alongside grouped reasoning models', async () => {
  const stdout = agyJsonModelsStdout({
    conversation_id: '',
    status: 'SUCCESS',
    response: [
      'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
      'claude-3-5-sonnet\tClaude 3.5 Sonnet',
    ].join('\n'),
  })
  const ctx = modelCatalogCtx([{ stdout, stderr: '', exitCode: 0 }])
  const adapter = new AntigravityCliAdapter(ctx, config)

  const models = await adapter.listModels('antigravity-cli')
  const modelIds = models.map(m => String(m.id)).sort()
  assert.deepEqual(modelIds, ['claude-3-5-sonnet', 'gemini-3.7-flash'])

  const claude = await adapter.resolveModel('antigravity-cli', 'claude-3-5-sonnet')
  assert.equal(String(claude.id), 'claude-3-5-sonnet')
  assert.equal(claude.name, 'Claude 3.5 Sonnet')
  assert.equal(claude.reasoning, undefined)
})
