import { Service, type Context } from '@deepseek-ai/cordis'
import {
  createSubagentProjectContext,
  type CreateSubagentProjectContextOptions,
  type SubagentProjectContext,
} from './subagent.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectMemory: ProjectMemoryService
  }
}

/**
 * DSH-owned project-memory capability exposed to managed provider plugins.
 * Provider plugins consume this service through Cordis `inject` and never need
 * a package-level dependency on the project-memory implementation.
 */
export class ProjectMemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'projectMemory')
  }

  createSubagentContext(
    options: CreateSubagentProjectContextOptions,
  ): Promise<SubagentProjectContext> {
    return createSubagentProjectContext(options)
  }
}
