/**
 * Everything this package knows about invoking the `grok` binary: the argv a
 * headless turn is spawned with, the isolation posture that argv encodes, and
 * the Windows shim wrapping every invocation shares.
 *
 * Internal to this package: not exported from `src/index.ts`.
 *
 * @module nishi-dsh-grok/grok-vendor
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
 * The built-in tool named by BOTH `--tools` and `--disallowed-tools`, which is
 * how this route reaches an empty vendor toolset.
 *
 * The obvious spelling does not work and fails open, which is the single most
 * dangerous fact in this vendor's surface: `--tools ""` is a silent no-op.
 * Measured on `grok 1.0.13`, an empty allowlist left the model holding the
 * FULL 25-tool set -- `run_terminal_command`, `write`, `search_replace`,
 * `spawn_subagent`, `web_search` and the rest -- at 13,423 uncached input
 * tokens. Claude Code's identically-spelled flag does the opposite, so the
 * analogy from `claude-code-cli-contract.md` actively misleads here.
 *
 * A one-name allowlist does work (`--tools read_file` yielded exactly that
 * tool plus the two always-on MCP meta-tools), and the vendor documents that
 * `--disallowed-tools` wins when both flags name a tool. Naming the same tool
 * in both therefore leaves `search_tool` and `use_tool` alone -- measured, at
 * 4,442 input tokens -- which is this route's isolation posture.
 *
 * Which tool is named does not matter, only that it is a real built-in the
 * allowlist accepts. `read_file` is the least surprising choice: read-only,
 * and denied before the model is ever told it exists.
 *
 * Pinned by `test/argv.test.ts`. See `docs/verification/grok-cli-contract.md`
 * findings 1 and 2.
 */
export const ISOLATION_TOOL_NAME = 'read_file'

/**
 * Tool names the vendor keeps regardless of the allowlist: its MCP
 * meta-tools. They are inert on this route because it registers no MCP server
 * and denies the `MCPTool` permission class outright, but they are reported by
 * `system`/`init` and must never be read as evidence that isolation failed.
 */
export const VENDOR_META_TOOLS: ReadonlySet<string> = new Set(['search_tool', 'use_tool'])

/** One resolved child-process invocation: argv plus the environment to run it in. */
export interface VendorInvocation {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export interface HeadlessTurnArgs {
  /** ACP content blocks for this step, already serialized. */
  readonly promptJson: string
  /** The forced decision schema for this step's tool catalog, already serialized. */
  readonly schemaJson: string
  /** Vendor model id. */
  readonly model: string
  /** Reasoning effort, when the request or the route default names one. */
  readonly effort?: string
  /** DSH's system prompt, which replaces the vendor agent's own. */
  readonly system?: string
  /** Client-minted session UUID. */
  readonly sessionId: string
  /** Whether this invocation continues that session rather than opening it. */
  readonly resume: boolean
  /** Ceiling on the vendor's own agent rounds for this step; see {@link headlessTurnArgv}. */
  readonly turnCap: number
}

/**
 * Argv for one DSH step.
 *
 * The shape is one short-lived process per step rather than a live child,
 * because this vendor's `--resume` keeps the prefix cache ACROSS processes:
 * measured on `grok 1.0.13`, a resumed second turn reported 140 uncached
 * input tokens against 4,480 read from cache. The whole live-child machinery
 * `packages/antigravity` needs -- delta envelopes, delivered-prefix matching,
 * cumulative-usage subtraction -- buys nothing here.
 *
 * Every flag below is load-bearing:
 *
 * - `--output-format json` is the one envelope this package parses, and
 *   `--json-schema` implies it anyway;
 * - `--max-turns` bounds the vendor's own agent loop, because DSH owns the
 *   loop. It is deliberately NOT `1`: the vendor spends a round when the model
 *   answers outside the schema and its structured-output retry has to ask
 *   again, and a cap of one turns that ordinary hiccup into a dead step. It was
 *   `1`, and the first real DSH request measured the cost -- the model spent
 *   its only round deciding to fetch the attached envelope, the vendor stderr
 *   read `Error: max turns reached`, and the step died reporting
 *   `stopReason: "cancelled"`;
 * - `--tools`/`--disallowed-tools` are the isolation posture (see
 *   {@link ISOLATION_TOOL_NAME}), and `Agent` in the denylist is the
 *   published spelling for "spawn no subagents";
 * - `--deny MCPTool` gates the two meta-tools the allowlist cannot remove;
 * - `--system-prompt-override` makes DSH's system prompt authoritative
 *   instead of layering it under the vendor agent's own;
 * - `--no-auto-update` keeps a self-update out of a turn's critical path.
 *
 * Deliberately NOT passed: `--always-approve`/`--yolo`. This route executes
 * every tool in DSH, so it needs no vendor approval at all -- and a managed
 * policy can refuse that flag outright (`/etc/grok/requirements.toml` with
 * `disable_bypass_permissions_mode = true` does exactly that on the machine
 * this package was written on). A transport that needed auto-approval would
 * be one admin config away from not running.
 */
export function headlessTurnArgv(args: HeadlessTurnArgs): string[] {
  return [
    '--prompt-json', args.promptJson,
    '--output-format', 'json',
    '--json-schema', args.schemaJson,
    '--model', args.model,
    ...(args.effort === undefined ? [] : ['--reasoning-effort', args.effort]),
    ...(args.system === undefined ? [] : ['--system-prompt-override', args.system]),
    '--max-turns', String(args.turnCap),
    '--tools', ISOLATION_TOOL_NAME,
    '--disallowed-tools', `${ISOLATION_TOOL_NAME},Agent`,
    '--deny', 'MCPTool',
    '--disable-web-search',
    '--no-subagents',
    '--no-plan',
    '--no-auto-update',
    ...(args.resume ? ['--resume', args.sessionId] : ['--session-id', args.sessionId]),
  ]
}

/** Argv for the turn-free ACP handshake that reads the model catalog. */
export function agentStdioArgv(): string[] {
  return ['agent', 'stdio']
}

/**
 * Resolves `executable` to an absolute path and builds the argv/env to spawn
 * it with `args`, transparently wrapping a Windows `.cmd`/`.bat` shim in a
 * `cmd.exe /d /v:off /s /c` invocation, the way every other subscription-CLI
 * provider in this suite does.
 *
 * Both of this package's invocation call sites -- the headless turn and the
 * ACP catalog handshake -- go through this one function, because a Windows
 * shim bug of exactly that shape has already happened once in this suite:
 * Codex had its `.cmd`/`.bat` wrapping applied on one vendor path and not the
 * other.
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
