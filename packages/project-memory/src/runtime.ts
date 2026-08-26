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
      // Reached filesystem root with no .git marker found; fallback to normalized cwd
      return normalize(cwd)
    }
    currentDir = parent
  }
}

/**
 * Renders the deterministic model-facing markdown context for DSH project sources.
 * Returns null if both DSH.md and MEMORY.md are absent.
 */
export function renderDshProjectContext(context: DshProjectContext): string | null {
  const sections: string[] = []

  if (context.projectContract.exists && context.projectContract.content !== null) {
    sections.push(`## Project Contract (DSH.md)\n${context.projectContract.content}`)
  }

  if (context.memoryBootstrap.exists && context.memoryBootstrap.content !== null) {
    sections.push(`## Project Memory (.dsh/memory/MEMORY.md)\n${context.memoryBootstrap.content}`)
  }

  if (sections.length === 0) {
    return null
  }

  return `# DSH Project Context\n\n${sections.join('\n\n')}`
}

function isTask7ProjectContextMessage(msg: any): boolean {
  if (!msg || typeof msg !== 'object') return false
  const source = msg.source
  return (
    source?.kind === 'plugin' &&
    source?.plugin === 'project-memory' &&
    source?.form === 'instructions'
  )
}

function hasVisibleProjectContext(agent: any): boolean {
  const nodes = agent?.session?.surface?.nodes
  const events = agent?.session?.events
  if (!nodes || !Array.isArray(nodes) || !events) return false
  for (const seq of nodes) {
    const event = events[seq]
    if (
      event?.type === 'user/message' &&
      isTask7ProjectContextMessage(event.data)
    ) {
      return true
    }
  }
  return false
}

/**
 * Internal runtime registration for project-memory context injection at agent/pre-step.
 */
export function registerProjectContextRuntime(ctx: Context): void {
  const initializedRoots = new Set<string>()
  const inFlightInits = new Map<string, Promise<void>>()

  async function ensureProjectInitialized(projectRoot: string): Promise<void> {
    const normRoot = normalize(projectRoot)
    if (initializedRoots.has(normRoot)) {
      return
    }

    let inFlight = inFlightInits.get(normRoot)
    if (!inFlight) {
      inFlight = (async () => {
        try {
          await initializeDshProject(normRoot)
          initializedRoots.add(normRoot)
        } finally {
          inFlightInits.delete(normRoot)
        }
      })()
      inFlightInits.set(normRoot, inFlight)
    }

    await inFlight
  }

  ctx.on(
    'agent/pre-step',
    async (payload: any, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
      payload.signal?.throwIfAborted()

      const decision = await next()
      if (decision.kind === 'reject') {
        return decision
      }

      payload.signal?.throwIfAborted()

      // Do NOT inject a standalone request for an empty first-step decision:
      if (payload.step === 1 && decision.messages.length === 0) {
        return decision
      }

      // Check visible surface nodes
      if (hasVisibleProjectContext(payload.agent)) {
        return decision
      }

      // Check current decision messages
      if (decision.messages.some(isTask7ProjectContextMessage)) {
        return decision
      }

      const rawCwd = payload.agent?.session?.header?.cwd
      if (typeof rawCwd !== 'string' || rawCwd.trim().length === 0 || !isAbsolute(rawCwd)) {
        throw new Error('Project context operation failed: invalid workspace session cwd.')
      }

      const projectRoot = await findProjectRoot(rawCwd, payload.signal)
      payload.signal?.throwIfAborted()

      await ensureProjectInitialized(projectRoot)
      payload.signal?.throwIfAborted()

      const projectContext = await readDshProjectContext({
        projectRoot,
        signal: payload.signal,
      })
      payload.signal?.throwIfAborted()

      const rendered = renderDshProjectContext(projectContext)
      if (!rendered) {
        return decision
      }

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
