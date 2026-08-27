import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const MEMORY_MAINTENANCE_DIRECTIVE = `[Project Memory Maintenance Directive]
Review recent work and current session context for DURABLE project knowledge only.

Instructions:
1. Read the canonical bootstrap file using memory_read(topic="memory").
2. Read relevant topic memories on demand using memory_read(topic="<topic>").
3. Create or update topic memories using memory_write / memory_edit.
4. Keep MEMORY.md compact (<= 200 lines, <= 25 KiB) and maintain its Memory map section so future agents can discover topic files.
5. Save ONLY approved durable knowledge categories:
   - durable decisions and reasons
   - constraints
   - verified root causes
   - tricky durable behavior
   - durable workflows
   - significant state / milestones
   - rejected approaches when the rejection reason remains useful
6. NEVER save:
   - raw chain-of-thought or transient reasoning
   - huge logs or command outputs
   - easily rediscovered source facts
   - secrets, tokens, passwords, or credentials
   - current quota or usage values
   - transient provider status
   - personal facts about the operator: their identity, accounts, machine or OS details, shell and tool preferences, or working habits
7. Project memory is committed to the repository and travels with it to everyone who has access. Durable knowledge about the OPERATOR belongs to the operator, not to the project: drop it rather than filing it under an approved category such as durable workflows.
8. Do not make unrelated code or project file edits.
9. Finish with a concise user-facing summary of memory files actually changed.`

export const MEMORY_CONSOLIDATION_DIRECTIVE = `[Project Memory Consolidation Directive]
Clean up and organize existing DSH-owned project memory.

Instructions:
1. Read the canonical bootstrap file using memory_read(topic="memory").
2. Read topic memories referenced by the memory map as needed using memory_read(topic="<topic>").
3. Compact MEMORY.md to remain a concise (<= 200 lines, <= 25 KiB) bootstrap.
4. Move detailed content into topic files where useful.
5. Remove duplicate or obsolete content from existing memories using memory_write / memory_edit.
6. Preserve useful decisions, reasons, constraints, root causes, and current durable state.
7. Do NOT invent new project facts.
8. Do NOT summarize source code merely to fill memory.
9. Do NOT write secrets, tokens, credentials, quota, raw chain-of-thought, or transient logs.
10. Do NOT write personal facts about the operator: their identity, accounts, machine or OS details, shell and tool preferences, or working habits. Remove any already present, because this store is committed and shared with everyone who has the repository.
11. Do NOT use shell or filesystem deletion commands as a substitute for a missing memory_delete operation.
12. Finish with a concise user-facing summary of memory content reorganized.`

export interface ResolvedModelRoute {
  provider: string
  model: string
}

export type ResolutionErrorCode =
  | 'invalid_selector'
  | 'llm_unavailable'
  | 'unknown_provider'
  | 'model_unavailable'
  | 'cancelled'

export class CommandResolutionError extends Error {
  constructor(
    public readonly code: ResolutionErrorCode,
    public readonly detail?: string,
  ) {
    super(code)
  }
}

const activeMaintenanceAgents = new WeakSet<Agent>()

export async function resolveModelSelector(
  commandCtx: Context,
  _agent: Agent,
  selector: string,
  signal?: AbortSignal,
): Promise<ResolvedModelRoute> {
  if (signal?.aborted) throw new CommandResolutionError('cancelled')
  const trimmed = selector.trim()
  if (!trimmed || trimmed.length > 256 || /[\x00-\x1F\x7F]/.test(trimmed)) throw new CommandResolutionError('invalid_selector')
  const slashIndex = trimmed.indexOf('/')
  if (slashIndex === -1) throw new CommandResolutionError('invalid_selector')
  const provider = trimmed.slice(0, slashIndex).trim()
  const model = trimmed.slice(slashIndex + 1).trim()
  if (!provider || !model) throw new CommandResolutionError('invalid_selector')
  const llm = (commandCtx as any).llm
  if (!llm || typeof llm.listProviders !== 'function' || typeof llm.resolveModelInfo !== 'function') throw new CommandResolutionError('llm_unavailable')
  let providers: Array<{ id: string; name?: string }>
  try { providers = llm.listProviders() } catch {
    if (signal?.aborted) throw new CommandResolutionError('cancelled')
    throw new CommandResolutionError('llm_unavailable')
  }
  if (!Array.isArray(providers)) throw new CommandResolutionError('llm_unavailable')
  if (!providers.find((p) => p?.id === provider)) throw new CommandResolutionError('unknown_provider', provider)
  try { await llm.resolveModelInfo(provider, model, signal) } catch {
    if (signal?.aborted) throw new CommandResolutionError('cancelled')
    throw new CommandResolutionError('model_unavailable')
  }
  if (signal?.aborted) throw new CommandResolutionError('cancelled')
  return { provider, model }
}

function formatResolutionError(err: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return 'Command cancelled.'
  if (err instanceof CommandResolutionError) {
    switch (err.code) {
      case 'cancelled': return 'Command cancelled.'
      case 'invalid_selector': return 'Invalid provider/model selector.'
      case 'llm_unavailable': return 'DSH LLM service is unavailable.'
      case 'unknown_provider': return `Unknown provider "${err.detail}".`
      case 'model_unavailable': return 'Requested provider/model is unavailable.'
    }
  }
  return 'Requested provider/model is unavailable.'
}

export function scheduleMaintenanceTurn(agent: Agent, route: ResolvedModelRoute, directiveText: string): void {
  const maintenanceMessage = createUserMessage({ content: [{ type: 'text', text: directiveText }], source: { kind: 'user' } })
  const targetMessageId = maintenanceMessage.id
  const selectionRef: ModelSelectionRef = { current: undefined, assembled: undefined }
  const disposeModelSelection = installModelSelection(agent.ctx, selectionRef)
  let activated = false
  let maintenanceTurn: number | undefined = undefined
  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    activeMaintenanceAgents.delete(agent)
    selectionRef.current = undefined
    selectionRef.assembled = undefined
    disposeModelSelection(); disposePreStep(); disposeTurnStopping(); disposeError()
  }
  const disposePreStep = agent.ctx.on('agent/pre-step', async (payload: any, next: () => Promise<any>) => {
    if (cleanedUp) return await next()
    if (activated && typeof payload?.turn === 'number' && payload.turn !== maintenanceTurn) { cleanup(); return await next() }
    const decision = await next()
    if (cleanedUp) return decision
    if (!activated && decision?.kind === 'enter' && Array.isArray(decision.messages) && decision.messages.some((m: any) => m?.id === targetMessageId || m === maintenanceMessage)) {
      selectionRef.current = { provider: route.provider, model: route.model }
      activated = true
      maintenanceTurn = typeof payload?.turn === 'number' ? payload.turn : undefined
    }
    return decision
  })
  const disposeError = agent.ctx.on('agent/error', (payload: any) => {
    if (!activated) return
    if (typeof payload?.turn === 'number' && typeof maintenanceTurn === 'number' && payload.turn !== maintenanceTurn) return
    cleanup()
  })
  const disposeTurnStopping = agent.ctx.on('agent/turn-stopping', (payload: any) => {
    if (!activated) return
    if (typeof payload?.turn === 'number' && typeof maintenanceTurn === 'number' && payload.turn !== maintenanceTurn) return
    cleanup()
  })
  try { agent.steer(maintenanceMessage) } catch (err) { cleanup(); throw err }
  agent.whenIdle().then(cleanup, cleanup)
}

export function registerMemoryCommands(ctx: Context): void {
  const registerInto = (commandCtx: any) => {
    if (!commandCtx?.commands || typeof commandCtx.commands.register !== 'function') return
    commandCtx.commands.register({
      name: 'memory', description: 'Review recent work and update project memory', input: { hint: '<provider>/<model>' },
      handler: async ({ agent, rawInput, signal }: any) => {
        if (signal?.aborted) return { kind: 'error', text: 'Command cancelled.' }
        const selector = rawInput?.trim() ?? ''
        if (!selector) return { kind: 'error', text: 'Usage: /memory <provider>/<model>' }
        let route: ResolvedModelRoute
        try { route = await resolveModelSelector(commandCtx, agent, selector, signal) } catch (err) { return { kind: 'error', text: formatResolutionError(err, signal) } }
        if (signal?.aborted) return { kind: 'error', text: 'Command cancelled.' }
        if (activeMaintenanceAgents.has(agent)) return { kind: 'error', text: 'Another maintenance command is already pending or active on this agent.' }
        activeMaintenanceAgents.add(agent)
        try { scheduleMaintenanceTurn(agent, route, MEMORY_MAINTENANCE_DIRECTIVE) } catch { activeMaintenanceAgents.delete(agent); return { kind: 'error', text: 'Failed to schedule memory maintenance.' } }
        return { kind: 'success', text: 'Memory maintenance scheduled.' }
      },
    })
    commandCtx.commands.register({
      name: 'consolidate', description: 'Clean up and organize existing project memory', input: { hint: '<provider>/<model>' },
      handler: async ({ agent, rawInput, signal }: any) => {
        if (signal?.aborted) return { kind: 'error', text: 'Command cancelled.' }
        const selector = rawInput?.trim() ?? ''
        if (!selector) return { kind: 'error', text: 'Usage: /consolidate <provider>/<model>' }
        let route: ResolvedModelRoute
        try { route = await resolveModelSelector(commandCtx, agent, selector, signal) } catch (err) { return { kind: 'error', text: formatResolutionError(err, signal) } }
        if (signal?.aborted) return { kind: 'error', text: 'Command cancelled.' }
        if (activeMaintenanceAgents.has(agent)) return { kind: 'error', text: 'Another maintenance command is already pending or active on this agent.' }
        activeMaintenanceAgents.add(agent)
        try { scheduleMaintenanceTurn(agent, route, MEMORY_CONSOLIDATION_DIRECTIVE) } catch { activeMaintenanceAgents.delete(agent); return { kind: 'error', text: 'Failed to schedule memory consolidation.' } }
        return { kind: 'success', text: 'Memory consolidation scheduled.' }
      },
    })
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['commands', 'llm'], (commandCtx: any) => registerInto(commandCtx))
  } else {
    const fallback = ctx as any
    if (fallback.commands && fallback.llm) registerInto(fallback)
  }
}
