/**
 * The `mcp-bridge` transport's pure parts: the vendor agent definition, the
 * tool catalog handed to the bridge, and the projection of a DSH tool result
 * back into the text the vendor's MCP client receives.
 *
 * Kept separate from `antigravity-primary.ts` because none of it needs a
 * process, a socket or a vendor, so all of it is testable directly. The
 * stateful half -- racing a blocked vendor turn against a bridge call -- stays
 * in the adapter, where the session lives.
 *
 * Internal to this package.
 *
 * @module nishi-dsh-antigravity/mcp-transport
 */
import type { ContentBlock, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { BridgeToolDeclaration } from './mcp-bridge.js'

/** The vendor tool that reaches DSH's catalog through the bridge. */
export const VENDOR_MCP_TOOL = 'call_mcp_tool'

/** The vendor's completion tool, kept so a turn can end without a DSH call. */
export const VENDOR_FINISH_TOOL = 'finish'

/**
 * The agent definition for the bridge transport.
 *
 * The allowlist is the whole isolation story on this path. Probed with the
 * vendor's default agent, `agy 1.1.22` exposed 57 native tools and used
 * `view_file` on a file outside the workspace unprompted, so an allowlist of
 * exactly `call_mcp_tool` plus `finish` is not belt-and-braces -- it is the
 * only thing standing between the model and the vendor's own filesystem,
 * shell and browser tools.
 *
 * Unlike the `schema` transport's definition, this one does not describe an
 * envelope protocol: the model calls DSH's tools natively and answers in
 * prose, which is the entire point of the transport.
 */
export function bridgeMcpAgentMarkdown(): string {
  return [
    '---',
    'name: dsh-primary-mcp',
    'description: DeepSeek Harness primary agent with DSH-owned tools.',
    'mainAgent: true',
    'subagent: false',
    'inheritCustomizations: false',
    'tools:',
    `  - ${VENDOR_MCP_TOOL}`,
    `  - ${VENDOR_FINISH_TOOL}`,
    '---',
    '',
    '# Core Instructions',
    '',
    'You are the model behind a DeepSeek Harness (DSH) session. DSH owns the tools,',
    'the permissions, the durable history, the workspace and the project memory.',
    '',
    '- Every tool you can call is a DSH tool, reached through the MCP server named in',
    '  your tool list. Call them as ordinary tools; DSH executes each one and returns',
    '  its real result to you in this same turn.',
    '- A tool call may take a long time, because a human may be asked to approve it.',
    '  Waiting is normal. Never abandon a call and retry it because it is slow.',
    '- Never use an Antigravity-native filesystem, shell, web, plugin, skill or',
    '  subagent tool. Your allowlist does not contain them, and DSH provides the',
    '  equivalents it is willing to run.',
    '- Never repeat a tool call with the same name and the same arguments as your',
    '  previous call. If it succeeded you already have the answer; if it failed,',
    '  change something or say what is blocking you.',
    '- Answer in prose. There is no output schema on this route.',
    '',
  ].join('\n')
}

/**
 * The DSH catalog as the vendor's MCP client sees it.
 *
 * The schemas go across unmodified. The `schema` transport has to rewrite them
 * into the narrow subset `--json-schema` accepts; MCP carries a tool's own
 * `inputSchema` as-is, so the whole rewriting apparatus -- and the per-tool
 * bail-out it needs for composite keywords -- does not apply here.
 */
export function bridgeToolDeclarations(tools: readonly ToolSchema[] | undefined): BridgeToolDeclaration[] {
  return (tools ?? []).map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }))
}

/** One DSH tool result, projected for the vendor. */
export interface ProjectedToolResult {
  readonly text: string
  readonly isError: boolean
}

/** Flatten one result block's content to the text an MCP result can carry. */
function contentText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') { parts.push(block.text); continue }
    // A non-text block cannot cross an MCP text result. Naming the kind beats
    // dropping it silently: the model can ask for something it can read.
    parts.push(`[${block.type} content omitted: this route returns text only]`)
  }
  return parts.join('\n')
}

/**
 * Find the DSH tool result answering `callId` in the history of the request
 * that follows a blocked vendor call.
 *
 * DSH appends the result as a `tool-result` block citing the id the adapter
 * minted, so this looks by id rather than by position: a step may append more
 * than one message, and a tool result is never the request's own last word.
 *
 * @returns the projected result, or `undefined` when the history does not
 *   carry it -- which the caller must treat as a protocol failure rather than
 *   an empty result, because the vendor turn is still blocked on it.
 */
export function bridgeToolResult(
  messages: readonly Message[],
  callId: string,
): ProjectedToolResult | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined) continue
    const content = message.content
    if (!Array.isArray(content)) continue
    for (const block of content as readonly ContentBlock[]) {
      if (block.type !== 'tool-result') continue
      if (String(block.toolCallId) !== callId) continue
      return {
        text: contentText(block.content),
        isError: block.isError === true,
      }
    }
  }
  return undefined
}

/**
 * Whether a request may use the bridge at all.
 *
 * An auxiliary call must not: compaction and session titles bring their own
 * one-off history and want prose with no tool calls in it, which is exactly
 * what the `schema` transport's message-only schema already guarantees. Giving
 * a summarizer a live tool catalog is how compaction started answering with a
 * tool call in the first place.
 */
export function bridgeEligible(purpose: unknown, tools: readonly ToolSchema[] | undefined): boolean {
  return purpose === undefined && (tools ?? []).length > 0
}
