import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'node:module'

const hostRequire = createRequire(import.meta.url)
const sdkRequire = createRequire(hostRequire.resolve('@anthropic-ai/claude-agent-sdk'))
const z = (sdkRequire('zod') as any).z

export const CLAUDE_MEMORY_SERVER_NAME = 'dsh-memory'
export const CLAUDE_MEMORY_ALLOWED_TOOL = 'mcp__dsh-memory__memory_read'

export interface SubagentProjectContextLike {
  readonly projectRoot: string
  readonly renderedBootstrap: string | null
  readTopic(topic: string, signal?: AbortSignal): Promise<{
    readonly topic: string
    readonly exists: boolean
    readonly content: string | null
  }>
}

export interface ProjectMemoryServiceLike {
  createSubagentContext(options: {
    readonly cwd: string
    readonly signal?: AbortSignal
  }): Promise<SubagentProjectContextLike>
}

export interface ClaudeSubagentMemory {
  readonly bootstrap: string | null
  readonly mcpServer: ReturnType<typeof createSdkMcpServer>
  readonly allowedTool: string
}

export async function runClaudeMemoryRead(
  context: SubagentProjectContextLike,
  topic: string,
  signal?: AbortSignal,
): Promise<any> {
  try {
    const result = await context.readTopic(topic, signal)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    }
  } catch {
    return {
      content: [{ type: 'text' as const, text: 'DSH project memory read failed.' }],
      isError: true,
    }
  }
}

export function createClaudeSubagentMemoryFromContext(
  context: SubagentProjectContextLike,
  signal?: AbortSignal,
): ClaudeSubagentMemory {
  const memoryRead = tool(
    'memory_read',
    'Read one DSH-owned durable project memory topic. Read-only; paths and filenames are not accepted.',
    {
      topic: z.string(),
    },
    async ({ topic }: { topic: unknown }) => {
      if (typeof topic !== 'string') {
        return {
          content: [{ type: 'text' as const, text: 'DSH project memory read failed.' }],
          isError: true,
        }
      }
      return runClaudeMemoryRead(context, topic, signal)
    },
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  )

  return {
    bootstrap: context.renderedBootstrap,
    mcpServer: createSdkMcpServer({
      name: CLAUDE_MEMORY_SERVER_NAME,
      version: '0.1.0',
      tools: [memoryRead],
    }),
    allowedTool: CLAUDE_MEMORY_ALLOWED_TOOL,
  }
}

export async function createClaudeSubagentMemory(
  service: ProjectMemoryServiceLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<ClaudeSubagentMemory> {
  const context = await service.createSubagentContext({ cwd, signal })
  return createClaudeSubagentMemoryFromContext(context, signal)
}

export function claudePromptWithProjectMemory(
  task: string,
  bootstrap: string | null | undefined,
): string {
  if (bootstrap === null || bootstrap === undefined || bootstrap.length === 0) {
    return task
  }

  return `${bootstrap}\n\n# Delegated Task\n\n${task}`
}
