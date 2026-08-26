/**
 * Projection from the shared managed-process handle to the official Claude
 * Agent SDK's custom-spawn process interface.
 *
 * Upstream Reference:
 * deepseek-ai/deepseek-harness@0.1.1-rc.2 (SHA b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
 * packages/subagent/subagent-claude-code/src/process.ts
 *
 * @module dsh-subagent-claude-code-custom/process
 */

import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Encode the SDK's complete child environment as a subprocess overlay.
 * @param env - SDK-composed child environment after its removals and replacements.
 * @returns explicit values plus tombstones for surviving ambient names the SDK removed.
 */
export function sdkEnvironmentOverlay(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const overlay: Record<string, string | undefined> = { ...env }
  for (const name of Object.keys(scrubbedParentEnv())) {
    if (!(name in env)) {
      overlay[name] = undefined
    }
  }
  return overlay
}

/**
 * Translate one official SDK spawn request to the shared process owner.
 * @param options - command, arguments, workspace, environment, and forwarded signal from the SDK.
 * @param graceMs - process-tree termination grace.
 * @returns the fully explicit shared subprocess request.
 */
export function claudeSpawnSpec(options: SpawnOptions, graceMs: number): SubprocessSpawnSpec {
  if (options.cwd === undefined || options.cwd.length === 0) {
    throw new Error('subagent-claude-code: SDK spawn request omitted its workspace')
  }
  return {
    argv: [options.command, ...options.args],
    cwd: options.cwd,
    stdio: {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
    },
    graceMs,
    signal: options.signal,
    env: sdkEnvironmentOverlay(options.env),
  }
}

/**
 * SDK-facing view of one shared managed process. Protocol transport remains
 * in the official SDK; this adapter only projects streams and exit events.
 */
export class ManagedClaudeCodeProcess implements SpawnedProcess {
  readonly child: SubprocessHandle
  readonly stdin: Writable
  readonly stdout: Readable
  private readonly events = new EventEmitter()
  private outcomeValue?: SubprocessOutcome
  private killRequested = false

  /**
   * Project a managed process with piped stdin and stdout.
   * @param child - shared handle that remains the process-tree authority.
   */
  constructor(child: SubprocessHandle) {
    this.child = child
    this.stdin = child.stdin as Writable
    this.stdout = child.stdout as Readable
    this.events.on('error', () => {})
    child.done.then(
      (outcome) => {
        this.outcomeValue = outcome
        this.events.emit('exit', outcome.exitCode, outcome.signal)
      },
      (error: unknown) => {
        this.events.emit('error', thrown(error))
      },
    )
  }

  /** Whether the SDK has requested managed tree termination. */
  get killed(): boolean {
    return this.killRequested
  }

  /** Direct-child exit code, or null while running or after signal exit. */
  get exitCode(): number | null {
    return this.outcomeValue?.exitCode ?? null
  }

  /** Direct-child terminating signal, if any. */
  get signalCode(): NodeJS.Signals | null {
    return (this.outcomeValue?.signal as NodeJS.Signals) ?? null
  }

  /** Exact managed-process outcome after exit, or undefined while running. */
  get outcome(): SubprocessOutcome | undefined {
    return this.outcomeValue
  }

  /**
   * Route the SDK's termination request to the tree-scoped process owner.
   * @param _signal - SDK-selected signal; the shared seam owns its escalation ladder.
   * @returns false only after exit or a previous termination request.
   */
  kill(_signal?: number | NodeJS.Signals): boolean {
    if (this.killRequested || this.outcomeValue !== undefined) return false
    this.killRequested = true
    this.child.terminate()
    return true
  }

  /** Register a persistent process lifecycle listener. */
  on(event: string, listener: (...args: any[]) => void): this {
    this.events.on(event, listener)
    return this
  }

  /** Register a one-shot process lifecycle listener. */
  once(event: string, listener: (...args: any[]) => void): this {
    this.events.once(event, listener)
    return this
  }

  /** Remove a process lifecycle listener. */
  off(event: string, listener: (...args: any[]) => void): this {
    this.events.off(event, listener)
    return this
  }
}
