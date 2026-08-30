/**
 * Helpers shared by every place in this package that talks to the `agy`
 * vendor process directly: the primary model bridge (`antigravity-primary.ts`)
 * and the native `search_web` backend (`web-search-backend.ts`). Each helper
 * below used to be reimplemented near-verbatim in both files; they are
 * collected here so a fix or an added guard only has to be made once.
 *
 * Internal to this package: not exported from `src/index.ts`, and not part
 * of `nishi-dsh-antigravity`'s public surface.
 *
 * @module nishi-dsh-antigravity/agy-vendor
 */
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'

/** Narrows `value` to a plain (non-null, non-array) object, or `undefined`. */
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Extracts every native-tool name `agy` reported invoking across a
 * stream-json event log, in emission order (repeats included). Tolerates
 * both an event carrying its `step_type`/`tool_name` fields directly and one
 * that nests them under `step_update`, and both a flat `tool_name` and a
 * `tool_info.tool_name`/`tool_info.name` shape.
 */
export function nativeToolNames(events: readonly Record<string, unknown>[]): string[] {
  const names: string[] = []
  for (const event of events) {
    const step = record(event.step_update) ?? event
    if (step.step_type !== 'tool') continue
    const toolInfo = record(step.tool_info)
    const name = step.tool_name ?? toolInfo?.tool_name ?? toolInfo?.name
    if (typeof name === 'string') names.push(name)
  }
  return names
}

/** One resolved child-process invocation: argv plus the environment to run it in. */
export interface VendorInvocation {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/**
 * Resolves `executable` to an absolute path and builds the argv/env to spawn
 * it with `args`, transparently wrapping a Windows `.cmd`/`.bat` shim in a
 * `cmd.exe /d /v:off /s /c` invocation, the way every other subscription-CLI
 * provider in this suite does.
 *
 * This is one shared function rather than two copies specifically because a
 * Windows shim bug of exactly that shape has already happened once in this
 * suite: Codex had its `.cmd`/`.bat` wrapping applied on one vendor
 * invocation path but not the other. Antigravity has two independent
 * invocation call sites too (the primary bridge and the native web-search
 * backend); routing both through this function is what keeps them from
 * drifting apart the same way.
 *
 * `windowsExecutableEnvVar` stays a caller-supplied parameter rather than a
 * shared constant: the primary bridge and the search backend run as
 * separate `agy` subprocesses and must not collide on the same indirection
 * variable name.
 */
export async function resolveVendorInvocation(
  ctx: Context,
  executable: string,
  env: Readonly<Record<string, string>>,
  args: readonly string[],
  signal: AbortSignal,
  windowsExecutableEnvVar: string,
): Promise<VendorInvocation> {
  const resolved = await ctx.subprocess.resolveExecutable(executable, env, signal)
  const extension = extname(resolved).toLowerCase()
  if (process.platform !== 'win32' || (extension !== '.cmd' && extension !== '.bat')) {
    return { argv: [resolved, ...args], env }
  }
  const commandInterpreter = await ctx.subprocess.resolveExecutable('cmd.exe', env, signal)
  return {
    argv: [
      commandInterpreter,
      '/d',
      '/v:off',
      '/s',
      '/c',
      `%${windowsExecutableEnvVar}%`,
      ...args,
    ],
    env: { ...env, [windowsExecutableEnvVar]: `"${resolved}"` },
  }
}
