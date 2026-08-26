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

export interface CodexSubagentMemory {
  readonly bootstrap: string | null
  read(topic: string, signal?: AbortSignal): Promise<{
    readonly topic: string
    readonly exists: boolean
    readonly content: string | null
  }>
}

export const CODEX_MEMORY_DYNAMIC_TOOL = {
  name: 'memory_read',
  description:
    'Read one DSH-owned durable project memory topic. Read-only; paths and filenames are not accepted.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
    },
    required: ['topic'],
    additionalProperties: false,
  },
} as const

export async function createCodexSubagentMemory(
  service: ProjectMemoryServiceLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<CodexSubagentMemory> {
  const context = await service.createSubagentContext({ cwd, signal })
  return {
    bootstrap: context.renderedBootstrap,
    read(topic: string, readSignal: AbortSignal | undefined = signal) {
      return context.readTopic(topic, readSignal)
    },
  }
}
