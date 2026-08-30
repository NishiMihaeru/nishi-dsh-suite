/**
 * Compatibility bridge for the Codex App Server primary provider.
 *
 * The App Server adapter can import foreign assistant text and tool calls, but
 * its Responses history format is stricter than DSH's durable provider-neutral
 * history: foreign reasoning is not importable, Responses limits function-call
 * ids to 64 characters, and user/system input carries only text and images
 * while producer-supplied context may quote any block a plugin emitted. DSH
 * keeps the original messages unchanged; this bridge projects only the
 * transient request handed to Codex.
 *
 * Runtime selection is intentionally not handled here. RC2 uses the external
 * Codex CLI boundary configured by the provider itself.
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  deepFreeze,
  freezeMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { projectedContentText } from './codex-plugin-dsh/content-projection.js'
import {
  CODEX_APP_SERVER_PROVIDER,
  CodexAppServerAdapter,
} from './codex-plugin-dsh/index.js'

export { CODEX_APP_SERVER_PROVIDER }
const CODEX_CALL_ID_MAX_LENGTH = 64
const BRIDGE_STATE = Symbol.for('dsh-plugin.codex-primary.history-bridge.v2')

type AdapterStream = (options: GenerateOptions) => AsyncIterable<StreamChunk>

interface BridgeState {
  originalStream: AdapterStream
  patchedStream: AdapterStream
  owners: number
}

interface CodexAdapterPrototype {
  stream: AdapterStream
  [key: symbol]: unknown
  [key: string]: unknown
}

/**
 * Responses rejects call ids above 64 characters. Keep short provider ids
 * byte-for-byte and deterministically alias only oversized foreign ids.
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

    // Producer-supplied context is provider-neutral and may quote blocks
    // Responses input cannot carry -- a stopped subagent's settlement notice
    // repeats the child's terminal output, `tool-call` blocks included. Those
    // are projected to text here so the notice reaches Codex instead of
    // failing the turn and every later replay of the session. A tool-sourced
    // user message is exempt: its `tool-result` block is the one App Server
    // does import, as `function_call_output`.
    const projectableContext = (message.role === 'user' || message.role === 'system')
      && source?.kind !== 'tool'

    let messageChanged = false
    const content = message.content.flatMap((block) => {
      if (projectableContext && block.type !== 'text' && block.type !== 'image') {
        messageChanged = true
        return [{ type: 'text' as const, text: projectedContentText(block) }]
      }

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
  if (prototype.stream === state.patchedStream) prototype.stream = state.originalStream
  if (prototype[BRIDGE_STATE] === state) delete prototype[BRIDGE_STATE]
}

/** Patch the exact mounted Codex adapter prototype with history projection only. */
export async function installCodexPrimaryHistoryBridge(
  ctx: Context,
  customPrototype?: CodexAdapterPrototype,
): Promise<boolean> {
  const prototype: CodexAdapterPrototype | undefined =
    customPrototype ?? (CodexAppServerAdapter?.prototype as unknown as CodexAdapterPrototype | undefined)
  if (!prototype || typeof prototype.stream !== 'function') {
    throw new Error(
      'codex: installed codex-plugin-dsh does not expose the expected CodexAppServerAdapter.stream API',
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

    state = { originalStream, patchedStream, owners: 0 }
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
  }, 'codex: project foreign history before Codex primary import')

  return true
}
