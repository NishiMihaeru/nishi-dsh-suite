/** Text projection for content blocks App Server input cannot carry natively. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * Project one content block into a readable text stand-in.
 *
 * DSH's durable history is provider-neutral, so a `user` or `system` message
 * may carry blocks the Responses input format has no slot for: a subagent
 * settlement notice quotes the interrupted child's terminal output verbatim,
 * `tool-call` blocks included. Rejecting those blocks kills the active turn
 * and every later replay of that session, which is a far worse outcome than
 * showing the model a text rendering of what it already had a right to see.
 *
 * Text and image blocks reach App Server as native input items; callers map
 * those before consulting this projection. The one place an image can still
 * land here is nested inside a projected `tool-result`, where no input item is
 * being emitted to attach it to — that image is replaced by a marker, and its
 * bytes are not sent.
 * @param block - One block from a user, system, or nested tool-result content array.
 * @returns Text carrying the block's model-facing information.
 */
export function projectedContentText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'reasoning':
      return `[dsh: reasoning]\n${block.text}`
    case 'image':
      return '[dsh: image content]'
    case 'tool-call':
      return `[dsh: tool call ${block.name}(${block.arguments})]`
    case 'tool-result': {
      const label = block.isError === true ? 'failed tool result' : 'tool result'
      const nested = block.content.map(projectedContentText).join('\n')
      const header = `[dsh: ${label} for ${String(block.toolCallId)}]`
      return nested.length === 0 ? header : `${header}\n${nested}`
    }
    default:
      return `[dsh: ${JSON.stringify((block as { readonly type: string }).type)} content]`
  }
}
