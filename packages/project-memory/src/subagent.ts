import { readDshProjectContext } from './context.js'
import { findProjectRoot, renderDshProjectContext } from './runtime.js'
import { readTopicMemory } from './topics.js'

export interface SubagentMemoryReadResult {
  readonly topic: string
  readonly exists: boolean
  readonly content: string | null
}

export interface SubagentProjectContext {
  readonly projectRoot: string
  readonly renderedBootstrap: string | null
  readTopic(topic: string, signal?: AbortSignal): Promise<SubagentMemoryReadResult>
}

export interface CreateSubagentProjectContextOptions {
  readonly cwd: string
  readonly signal?: AbortSignal
}

export const SUBAGENT_MEMORY_GUIDANCE = `## Subagent Memory Access
Additional durable project topics are available through the read-only \`memory_read\` tool. Use exact topic identifiers from the Memory map. Durable project memory is owned by DSH and cannot be mutated from this subagent.`

function sanitizedReadFailure(topic: unknown): Error {
  const safeTopic =
    typeof topic === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(topic)
      ? topic
      : undefined
  return new Error(
    safeTopic === undefined
      ? 'Subagent project memory read failed.'
      : `Subagent project memory read failed for topic "${safeTopic}".`,
  )
}

/**
 * Creates a provider-neutral, read-only DSH project-memory view for one managed subagent run.
 *
 * The bootstrap is snapshotted once for the child prompt. Topic reads stay lazy and always
 * consult current durable DSH memory. Provider packages never receive filesystem paths.
 */
export async function createSubagentProjectContext(
  options: CreateSubagentProjectContextOptions,
): Promise<SubagentProjectContext> {
  options?.signal?.throwIfAborted()

  if (!options || typeof options !== 'object') {
    throw new TypeError('Subagent project context options must be an object.')
  }

  const projectRoot = await findProjectRoot(options.cwd, options.signal)
  options.signal?.throwIfAborted()

  const projectContext = await readDshProjectContext({
    projectRoot,
    signal: options.signal,
  })
  options.signal?.throwIfAborted()

  const rendered = renderDshProjectContext(projectContext)
  const renderedBootstrap =
    rendered === null ? null : `${rendered}\n\n${SUBAGENT_MEMORY_GUIDANCE}`

  const readTopic = async (
    topic: string,
    signal: AbortSignal | undefined = options.signal,
  ): Promise<SubagentMemoryReadResult> => {
    signal?.throwIfAborted()

    try {
      if (topic === 'memory') {
        const current = await readDshProjectContext({ projectRoot, signal })
        signal?.throwIfAborted()
        return {
          topic: 'memory',
          exists: current.memoryBootstrap.exists,
          content: current.memoryBootstrap.content,
        }
      }

      const current = await readTopicMemory(projectRoot, topic)
      signal?.throwIfAborted()
      return {
        topic: current.topic,
        exists: current.exists,
        content: current.content,
      }
    } catch (error) {
      if (signal?.aborted) {
        signal.throwIfAborted()
      }
      throw sanitizedReadFailure(topic)
    }
  }

  return {
    projectRoot,
    renderedBootstrap,
    readTopic,
  }
}
