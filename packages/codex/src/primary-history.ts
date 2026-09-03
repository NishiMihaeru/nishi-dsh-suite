/**
 * Project a Codex primary request into the subset App Server history can import.
 *
 * The adapter can import foreign assistant text and tool calls, but Responses
 * history is stricter than DSH's durable provider-neutral log: foreign
 * reasoning is not importable, function-call ids are capped at 64 characters,
 * and user/system input carries only text and images while producer-supplied
 * context may quote any block a plugin emitted. DSH keeps the original
 * messages unchanged; this rewrite applies only to the transient request.
 */

import { createHash } from 'node:crypto'
import {
  deepFreeze,
  freezeMessage,
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import { projectedContentText } from './codex-plugin-dsh/content-projection.js'

/**
 * Same route id as `CODEX_APP_SERVER_PROVIDER`. This module must not import
 * the adapter: `stream()` calls the projection, and importing the adapter
 * here would cycle.
 */
const CODEX_APP_SERVER_PROVIDER = 'codex-app-server'
const CODEX_CALL_ID_MAX_LENGTH = 64

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
