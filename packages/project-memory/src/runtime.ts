import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { type DshProjectContext, readDshProjectContext } from './context.js'
import { initializeDshProject } from './init.js'

/**
 * Safely discovers the project root from an explicit workspace session cwd.
 * Walks upward looking for a `.git` entry (directory, regular file, etc.).
 * If no marker is found up to filesystem root, returns normalized original cwd.
 */
export async function findProjectRoot(cwd: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()

  if (typeof cwd !== 'string' || cwd.trim().length === 0 || !isAbsolute(cwd)) {
    throw new Error('Project context operation failed: invalid workspace session cwd.')
  }

  let currentDir = normalize(cwd)
  while (true) {
    signal?.throwIfAborted()
    try {
      await lstat(join(currentDir, '.git'))
      return currentDir
    } catch (err: any) {
      signal?.throwIfAborted()
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
        // Marker absent at this directory level, continue upward
      } else {
        throw new Error('Project context operation failed: root discovery error.')
      }
    }

    const parent = dirname(currentDir)
    if (parent === currentDir) {
      return normalize(cwd)
    }
    currentDir = parent
  }
}

/** Renders the deterministic model-facing markdown context for DSH project sources. */
export function renderDshProjectContext(context: DshProjectContext): string | null {
  const sections: string[] = []

  if (context.projectContract.exists && context.projectContract.content !== null) {
    sections.push(`## Project Contract (DSH.md)\n${context.projectContract.content}`)
  }

  if (context.memoryBootstrap.exists && context.memoryBootstrap.content !== null) {
    sections.push(`## Project Memory (.dsh/memory/MEMORY.md)\n${context.memoryBootstrap.content}`)
  }

  if (sections.length === 0) return null
  return `# DSH Project Context\n\n${sections.join('\n\n')}`
}

function isProjectContextMessage(msg: any): boolean {
  if (!msg || typeof msg !== 'object') return false
  const source = msg.source
  return (
    source?.kind === 'plugin' &&
    source?.plugin === 'project-memory' &&
    source?.form === 'instructions'
  )
}

/**
 * The rendered context text carried by a project-context message, or null when
 * the message is not one. Identity is the payload, not the mere presence of a
 * marker: a stale copy on the surface must not suppress a changed one.
 */
function projectContextText(msg: any): string | null {
  if (!isProjectContextMessage(msg)) return null
  const content = msg.content
  if (!Array.isArray(content) || content.length !== 1) return null
  const part = content[0]
  if (part?.type !== 'text' || typeof part.text !== 'string') return null
  return part.text
}

/**
 * Text of the newest project-context message on the model-visible surface, or
 * null when none is visible.
 *
 * `Session` keeps its log private: `surface.nodes` yields absolute seqs that
 * only `session.eventAt` resolves. Reading the newest entry backwards is what
 * makes the caller's comparison a freshness check -- an earlier copy that a
 * later injection superseded is not what the model currently sees.
 */
function visibleProjectContext(agent: any): string | null {
  const session = agent?.session
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes) || typeof session.eventAt !== 'function') return null
  for (let i = nodes.length - 1; i >= 0; i--) {
    const event = session.eventAt(nodes[i])
    if (event?.type !== 'user/message') continue
    const text = projectContextText(event.data)
    if (text !== null) return text
  }
  return null
}

/** Internal runtime registration for project-memory context injection at agent/pre-step. */
export function registerProjectContextRuntime(ctx: Context): void {
  // Bounded by construction: this grows only up to the number of distinct
  // project roots this plugin instance has ever seen `agent/pre-step` for,
  // which is a small number in practice. No eviction is added deliberately --
  // evicting an entry would force a spurious re-initialization the next time
  // that same root is seen.
  const initializedRoots = new Set<string>()

  async function ensureProjectInitialized(projectRoot: string, signal?: AbortSignal): Promise<void> {
    const normRoot = normalize(projectRoot)
    if (initializedRoots.has(normRoot)) return
    signal?.throwIfAborted()
    await initializeDshProject(normRoot, signal)
    signal?.throwIfAborted()
    initializedRoots.add(normRoot)
  }

  ctx.on(
    'agent/pre-step',
    async (payload: any, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
      payload.signal?.throwIfAborted()

      const decision = await next()
      if (decision.kind === 'reject') return decision

      payload.signal?.throwIfAborted()
      if (payload.step === 1 && decision.messages.length === 0) return decision

      const rawCwd = payload.agent?.session?.header?.cwd
      if (typeof rawCwd !== 'string' || rawCwd.trim().length === 0 || !isAbsolute(rawCwd)) {
        throw new Error('Project context operation failed: invalid workspace session cwd.')
      }

      const projectRoot = await findProjectRoot(rawCwd, payload.signal)
      payload.signal?.throwIfAborted()

      await ensureProjectInitialized(projectRoot, payload.signal)
      payload.signal?.throwIfAborted()

      const projectContext = await readDshProjectContext({
        projectRoot,
        signal: payload.signal,
      })
      payload.signal?.throwIfAborted()

      const rendered = renderDshProjectContext(projectContext)
      if (!rendered) return decision

      // Re-inject only what the model is not already looking at. Comparing the
      // rendered payload rather than the marker keeps an edited DSH.md or
      // MEMORY.md reaching the model, while an unchanged one costs nothing:
      // every injected message is appended to the surface and therefore
      // re-sent with every later request in the session.
      if (visibleProjectContext(payload.agent) === rendered) return decision
      if (decision.messages.some((msg) => projectContextText(msg) === rendered)) return decision

      const contextMessage = createUserMessage({
        source: {
          kind: 'plugin',
          plugin: 'project-memory',
          form: 'instructions',
        },
        content: [{ type: 'text', text: rendered }],
      })

      return {
        kind: 'enter',
        messages: [...decision.messages, contextMessage as UserMessage],
      }
    },
    { prepend: true },
  )
}
