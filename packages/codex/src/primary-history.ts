/**
 * Compatibility and runtime resolution bridge for the pinned codex-plugin-dsh primary provider.
 *
 * The upstream App Server adapter can import foreign assistant text and tool
 * calls, but its Responses history format is stricter than DSH's durable
 * provider-neutral history: foreign reasoning is not importable and Responses
 * limits function-call ids to 64 characters. DSH keeps the original messages
 * unchanged; this bridge projects only the transient request handed to Codex.
 *
 * Additionally, this bridge ensures that the primary Codex provider executes
 * the package-local managed Codex runtime and code-mode host instead of resolving
 * an unmanaged or broken global executable from system PATH.
 *
 * Codex-owned reasoning and call ids are deliberately preserved. If the
 * upstream adapter must rebuild one of its own App Server threads, its stricter
 * lossless replay checks remain authoritative.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  deepFreeze,
  freezeMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  CODEX_APP_SERVER_PROVIDER,
  CodexAppServerAdapter,
} from './codex-plugin-dsh/index.js'
import { prependPath, resolveManagedCodexRuntime } from './resolver.js'

export { CODEX_APP_SERVER_PROVIDER }
const CODEX_CALL_ID_MAX_LENGTH = 64
const BRIDGE_STATE = Symbol.for('dsh-plugin.codex-primary.history-bridge.v2')

type AdapterStream = (options: GenerateOptions) => AsyncIterable<StreamChunk>
type AdapterOpenConnection = (
  cwd: string,
  signal: AbortSignal,
  requestHandler: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  observer?: unknown,
) => Promise<unknown>

interface BridgeState {
  originalStream: AdapterStream
  patchedStream: AdapterStream
  originalOpenConnection?: AdapterOpenConnection
  patchedOpenConnection?: AdapterOpenConnection
  owners: number
}

interface CodexAdapterPrototype {
  stream: AdapterStream
  openConnection?: AdapterOpenConnection
  [key: symbol]: unknown
  [key: string]: unknown
}

/**
 * Creates an effective Codex configuration ensuring package-local managed runtime resolution
 * without mutating the shared adapter instance configuration across asynchronous invocations.
 */
export function createEffectiveCodexConfig<
  T extends { executable?: string; env?: Record<string, string> },
>(
  config: T | undefined,
  profileRequire?: NodeRequire,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): T {
  const currentExecutable = config?.executable
  if (
    currentExecutable === undefined
    || currentExecutable === 'codex'
    || currentExecutable.trim().length === 0
  ) {
    const resolvedRuntime = resolveManagedCodexRuntime(platform, arch, profileRequire)
    const effectiveEnv = {
      ...config?.env,
      PATH: prependPath(resolvedRuntime.binDir, config?.env?.PATH ?? process.env.PATH, platform),
    }
    return {
      ...(config ?? ({} as T)),
      executable: resolvedRuntime.executable,
      env: effectiveEnv,
    }
  }
  return config ?? ({} as T)
}

/**
 * Responses rejects call ids above 64 characters. Keep short provider ids
 * byte-for-byte and deterministically alias only oversized foreign ids. The
 * hash-based alias is stable across the matching function call and result and
 * never leaks the provider-specific long id into the App Server request.
 */
function codexSafeForeignCallId(id: string): string {
  if (id.length <= CODEX_CALL_ID_MAX_LENGTH) return id
  return `dsh_${createHash('sha256').update(id).digest('hex').slice(0, 60)}`
}

function foreignCallIdAliases(options: GenerateOptions): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>()
  for (const message of options.messages) {
    if (
      message.role !== 'assistant'
      || message.source?.kind !== 'model'
      || message.source?.provider === CODEX_APP_SERVER_PROVIDER
    ) {
      continue
    }
    for (const block of message.content) {
      if (block.type !== 'tool-call' || block.id.length <= CODEX_CALL_ID_MAX_LENGTH) continue
      aliases.set(block.id, codexSafeForeignCallId(block.id))
    }
  }
  return aliases
}

/**
 * Project one already-assembled request into the subset the Codex App Server
 * history importer can represent. The durable DSH Session is never mutated.
 */
export function projectCodexPrimaryHistory(options: GenerateOptions): GenerateOptions {
  if (options.provider !== CODEX_APP_SERVER_PROVIDER) return options

  const callIdAliases = foreignCallIdAliases(options)
  let changed = false
  const messages = options.messages.map((message) => {
    const source = message.source
    const foreignAssistant = message.role === 'assistant'
      && source?.kind === 'model'
      && source?.provider !== CODEX_APP_SERVER_PROVIDER

    let messageChanged = false
    const content = message.content.flatMap((block) => {
      if (foreignAssistant && block.type === 'reasoning') {
        messageChanged = true
        return []
      }

      if (foreignAssistant && block.type === 'tool-call') {
        const alias = callIdAliases.get(block.id)
        if (alias !== undefined && alias !== block.id) {
          messageChanged = true
          return [{ ...block, id: alias as typeof block.id }]
        }
      }

      if (source?.kind === 'tool' && block.type === 'tool-result') {
        const alias = callIdAliases.get(block.toolCallId)
        if (alias !== undefined && alias !== block.toolCallId) {
          messageChanged = true
          return [{ ...block, toolCallId: alias as typeof block.toolCallId }]
        }
      }

      return [block]
    })

    let projectedSource = source
    if (source?.kind === 'tool') {
      const alias = callIdAliases.get(source.callId)
      if (alias !== undefined && alias !== source.callId) {
        messageChanged = true
        projectedSource = { ...source, callId: alias as typeof source.callId }
      }
    }

    if (!messageChanged) return message
    changed = true
    return freezeMessage({ ...message, content, source: projectedSource })
  })

  if (!changed) return options
  return deepFreeze({ ...options, messages })
}

function releaseBridge(prototype: CodexAdapterPrototype, state: BridgeState): void {
  state.owners = Math.max(0, state.owners - 1)
  if (state.owners !== 0) return

  if (prototype.stream === state.patchedStream) {
    prototype.stream = state.originalStream
  }
  if (
    prototype.openConnection
    && state.originalOpenConnection
    && prototype.openConnection === state.patchedOpenConnection
  ) {
    prototype.openConnection = state.originalOpenConnection
  }
  if (prototype[BRIDGE_STATE] === state) {
    delete prototype[BRIDGE_STATE]
  }
}

/**
 * Patch the exact installed codex-plugin-dsh adapter prototype without
 * vendoring or mutating the package on disk. The package is resolved directly
 * from nishi-dsh-codex's own dependencies, so the bridge deterministically
 * patches the exact same CodexAppServerAdapter that is mounted as primary.
 */
export async function installCodexPrimaryHistoryBridge(
  ctx: Context,
  customPrototype?: CodexAdapterPrototype,
): Promise<boolean> {
  const prototype: CodexAdapterPrototype | undefined =
    customPrototype ?? (CodexAppServerAdapter?.prototype as unknown as CodexAdapterPrototype | undefined)
  if (!prototype || typeof prototype.stream !== 'function') {
    throw new Error(
      'subagent-codex: installed codex-plugin-dsh does not expose the expected CodexAppServerAdapter.stream API',
    )
  }

  const existing = prototype[BRIDGE_STATE]
  let state: BridgeState
  if (
    existing !== null
    && typeof existing === 'object'
    && typeof (existing as BridgeState).originalStream === 'function'
    && typeof (existing as BridgeState).patchedStream === 'function'
    && typeof (existing as BridgeState).owners === 'number'
  ) {
    state = existing as BridgeState
  } else {
    const originalStream = prototype.stream
    const patchedStream: AdapterStream = function patchedCodexPrimaryStream(
      this: unknown,
      options: GenerateOptions,
    ): AsyncIterable<StreamChunk> {
      return originalStream.call(this, projectCodexPrimaryHistory(options))
    }

    let originalOpenConnection: AdapterOpenConnection | undefined
    let patchedOpenConnection: AdapterOpenConnection | undefined

    if (typeof prototype.openConnection === 'function') {
      originalOpenConnection = prototype.openConnection
      patchedOpenConnection = async function patchedCodexOpenConnection(
        this: { config?: { executable?: string; env?: Record<string, string> }; ctx?: Context },
        cwd: string,
        signal: AbortSignal,
        requestHandler: (method: string, params: Record<string, unknown>) => Promise<unknown>,
        observer?: unknown,
      ): Promise<unknown> {
        const localRequire = createRequire(import.meta.url)
        const effectiveConfig = createEffectiveCodexConfig(this.config, localRequire)
        if (effectiveConfig === this.config) {
          return originalOpenConnection!.call(this, cwd, signal, requestHandler, observer)
        }
        // Invocation-local receiver: delegates to `this` while shadowing `config` safely without mutation
        const invocationReceiver = Object.create(this, {
          config: {
            value: effectiveConfig,
            writable: true,
            enumerable: true,
            configurable: true,
          },
        })
        return originalOpenConnection!.call(invocationReceiver, cwd, signal, requestHandler, observer)
      }
      prototype.openConnection = patchedOpenConnection
    }

    state = {
      originalStream,
      patchedStream,
      originalOpenConnection,
      patchedOpenConnection,
      owners: 0,
    }
    prototype.stream = patchedStream
    Object.defineProperty(prototype, BRIDGE_STATE, {
      value: state,
      configurable: true,
      enumerable: false,
      writable: false,
    })
  }

  ctx.effect(() => {
    state.owners += 1
    return () => releaseBridge(prototype, state)
  }, 'subagent-codex: project foreign history before Codex primary import')

  return true
}
