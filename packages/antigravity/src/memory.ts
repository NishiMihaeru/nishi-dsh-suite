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

export interface AntigravitySubagentMemory {
  readonly bootstrap: string | null
  read(topic: string, signal?: AbortSignal): Promise<{
    readonly topic: string
    readonly exists: boolean
    readonly content: string | null
  }>
}

/** Internal compatibility alias while the accepted Antigravity runner is migrated unchanged. */
export type CodexSubagentMemory = AntigravitySubagentMemory

export async function createAntigravitySubagentMemory(
  service: ProjectMemoryServiceLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<AntigravitySubagentMemory> {
  const context = await service.createSubagentContext({ cwd, signal })
  return {
    bootstrap: context.renderedBootstrap,
    read(topic: string, readSignal: AbortSignal | undefined = signal) {
      return context.readTopic(topic, readSignal)
    },
  }
}

/** Internal compatibility alias for the byte-preserved accepted runner. */
export const createCodexSubagentMemory = createAntigravitySubagentMemory
