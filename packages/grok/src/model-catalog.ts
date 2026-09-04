/**
 * The model catalog, read from the vendor's ACP handshake.
 *
 * This is the cheapest catalog surface any provider in this suite has: the
 * `initialize` response to `grok agent stdio` carries every model the account
 * can route to, each with its real context window and its reasoning-effort
 * list, and reading it runs no turn, opens no session and spends no tokens.
 * Antigravity has to invoke `agy models` (which discloses an id and a display
 * name and nothing else) and then guess a context window from a deployment
 * constant; here both are published.
 *
 * The shape is undocumented, which is why it is parsed defensively and why
 * `test/model-catalog.test.ts` pins it: a vendor rename must fail a test
 * rather than a session. See `docs/verification/grok-cli-contract.md`,
 * finding 9 and inventory row 10.
 *
 * @module nishi-dsh-grok/model-catalog
 */
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { disposeVendorChild, outputLines } from 'nishi-dsh-core/runtime'
import { record } from './grok-vendor.js'

const MAX_ACP_LINE_BYTES = 4 * 1024 * 1024
const INITIALIZE_REQUEST_ID = 1

/** One reasoning effort a model exposes. */
export interface CatalogEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly isDefault: boolean
}

/** One model the vendor reports at handshake time. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  /** The vendor's own `totalContextTokens`, when it disclosed one. */
  readonly contextWindowTokens?: number
  readonly efforts: readonly CatalogEffort[]
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function parseEfforts(meta: Record<string, unknown> | undefined): CatalogEffort[] {
  const raw = meta?.reasoningEfforts
  if (!Array.isArray(raw)) return []
  const efforts: CatalogEffort[] = []
  for (const entry of raw) {
    const effort = record(entry)
    if (effort === undefined) continue
    // `id` and `value` were identical on every measured entry; `value` is
    // preferred because it is the field the vendor's own flag documents.
    const id = typeof effort.value === 'string'
      ? effort.value
      : typeof effort.id === 'string' ? effort.id : undefined
    if (id === undefined || id.length === 0) continue
    const label = typeof effort.label === 'string' && effort.label.length > 0 ? effort.label : id
    const description = typeof effort.description === 'string' && effort.description.length > 0
      ? effort.description
      : undefined
    efforts.push({
      id,
      name: label,
      ...(description === undefined ? {} : { description }),
      isDefault: effort.default === true,
    })
  }
  return efforts
}

/**
 * Read the model catalog out of one `initialize` result.
 *
 * Everything is optional but the id: a model whose entry carries no window or
 * no effort list is reported as a model with neither, because an absent
 * capability is a legal declared state and inventing one is worse than
 * reporting none.
 */
export function parseCatalog(initializeResult: unknown): CatalogModel[] {
  const result = record(initializeResult)
  const meta = record(result?._meta)
  const modelState = record(meta?.modelState)
  const available = modelState?.availableModels
  if (!Array.isArray(available)) return []

  const models: CatalogModel[] = []
  for (const entry of available) {
    const model = record(entry)
    if (model === undefined) continue
    const id = typeof model.modelId === 'string' ? model.modelId : undefined
    if (id === undefined || id.length === 0) continue
    const modelMeta = record(model._meta)
    const name = typeof model.name === 'string' && model.name.length > 0 ? model.name : id
    const description = typeof model.description === 'string' && model.description.length > 0
      ? model.description
      : undefined
    const contextWindowTokens = positiveInteger(modelMeta?.totalContextTokens)
    models.push({
      id,
      name,
      ...(description === undefined ? {} : { description }),
      ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }),
      efforts: parseEfforts(modelMeta),
    })
  }
  return models
}

/** The model the vendor reports as current, when the handshake named one. */
export function parseDefaultModelId(initializeResult: unknown): string | undefined {
  const meta = record(record(initializeResult)?._meta)
  const current = record(meta?.modelState)?.currentModelId
  return typeof current === 'string' && current.length > 0 ? current : undefined
}

export interface AcpHandshakeSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly signal?: AbortSignal
}

/**
 * Run one ACP `initialize` handshake and return its result object.
 *
 * The child is killed as soon as the response arrives: this route drives the
 * vendor through its headless entry, and the agent process exists here only
 * long enough to answer one question. `clientCapabilities` declares nothing --
 * no filesystem, no terminal -- because nothing is asked of this client and a
 * capability offered is a capability that can be called.
 */
export async function readAcpInitialize(spec: AcpHandshakeSpec): Promise<unknown> {
  const controller = new AbortController()
  const signal = spec.signal === undefined
    ? controller.signal
    : AbortSignal.any([spec.signal, controller.signal])

  const child = spec.spawn({
    argv: [...spec.argv],
    cwd: spec.cwd,
    stdio: {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: { maxBytes: spec.stderrMaxBytes },
    },
    graceMs: spec.disposeGraceMs,
    signal,
    env: { ...scrubbedParentEnv(), ...spec.env },
  })

  const stdin = child.stdin
  const stdout = child.stdout
  if (!stdin || !stdout) {
    await disposeVendorChild(child).catch(() => {})
    throw new Error('grok-catalog: ACP handshake did not expose stdio pipes')
  }
  stdin.on('error', () => {})
  stdout.on('error', () => {})

  let timer: NodeJS.Timeout | undefined
  stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: INITIALIZE_REQUEST_ID,
    method: 'initialize',
    params: { protocolVersion: 1, clientCapabilities: {} },
  })}\n`)

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('grok-catalog: ACP handshake timed out')
      if (!controller.signal.aborted) controller.abort(error)
      reject(error)
    }, spec.timeoutMs)
    timer.unref?.()
  })
  void timeout.catch(() => {})

  const protocol = (async (): Promise<unknown> => {
    for await (const line of outputLines(stdout, MAX_ACP_LINE_BYTES)) {
      if (line.trim().length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        throw new Error('grok-catalog: ACP handshake emitted malformed JSON', { cause: error })
      }
      const message = record(parsed)
      if (message === undefined || message.id !== INITIALIZE_REQUEST_ID) continue
      if (record(message.error) !== undefined) {
        throw new Error('grok-catalog: ACP handshake was refused')
      }
      return message.result
    }
    throw new Error('grok-catalog: ACP handshake ended before answering')
  })()
  void protocol.catch(() => {})

  let result: unknown
  let requestError: unknown
  try {
    result = await Promise.race([protocol, timeout])
  } catch (error) {
    requestError = error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (!controller.signal.aborted) controller.abort(new Error('grok-catalog: handshake complete'))
    try {
      await disposeVendorChild(child)
    } catch (cleanupError) {
      if (requestError !== undefined) {
        throw new AggregateError(
          [requestError, cleanupError],
          'grok-catalog: ACP handshake failed and cleanup also failed',
        )
      }
      throw cleanupError
    }
  }

  if (requestError !== undefined) throw requestError
  return result
}
