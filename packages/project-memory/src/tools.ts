import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  readProjectMemoryBootstrap,
  writeProjectMemoryBootstrap,
  editProjectMemoryBootstrap,
} from './bootstrap.js'
import { registerMemoryCommands } from './commands.js'
import { findProjectRoot, registerProjectContextRuntime } from './runtime.js'
import {
  readTopicMemory,
  writeTopicMemoryWithMap,
  editTopicMemoryWithMap,
} from './topics.js'
import { recoverPendingProjectMemoryTransaction } from './transaction.js'

interface SessionHeaderHolder {
  session?: {
    header?: {
      cwd?: string
    }
  }
}

/** Resolve memory tools through the same project-root discovery used by context injection. */
export async function projectRootFromToolExecution(exec: ToolRunContext): Promise<string> {
  const agent = exec.agent as SessionHeaderHolder | undefined
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    throw new Error('Project memory operation failed: agent workspace session cwd is unavailable.')
  }
  return findProjectRoot(cwd, exec.signal)
}

function sanitizeToolError(operation: string, topic: unknown): never {
  const safeTopic = typeof topic === 'string' && topic.length <= 64 ? ` for topic "${topic}"` : ''
  throw new Error(`Project memory ${operation} failed${safeTopic}.`)
}

function isBootstrapTopic(topic: unknown): boolean {
  return typeof topic === 'string' && topic.toLowerCase() === 'memory'
}

function rethrowCancellation(signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted()
}

const memoryReadTool = defineTool({
  name: 'memory_read',
  description:
    'Read one durable project topic memory on demand. Use exact topic identifiers listed in the injected ## Memory map. The bootstrap summary MEMORY.md is already injected in context, but can be read with special topic="memory". Do not pass filenames (e.g. MEMORY.md) or filesystem paths.',
  parameters: {
    topic: {
      type: 'string',
      description:
        'Topic identifier from ## Memory map (e.g. "architecture"), or special "memory" for bootstrap summary MEMORY.md. Do not pass filenames (.md) or paths.',
      required: true,
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', required: true },
        exists: { type: 'boolean', required: true },
        content: {
          oneOf: [
            { type: 'string' },
            { type: 'null' },
          ],
          required: true,
        },
      },
      additionalProperties: false,
    },
    render(_args, value) {
      if (!value.exists || value.content === null) {
        return [{ type: 'text', text: `Topic memory "${value.topic}" does not exist.` }]
      }
      return [{ type: 'text', text: value.content }]
    },
  },
  isConcurrencySafe: () => true,
  async execute(args, exec) {
    exec.signal.throwIfAborted()
    try {
      const projectRoot = await projectRootFromToolExecution(exec)
      await recoverPendingProjectMemoryTransaction(projectRoot, exec.signal)
      exec.signal.throwIfAborted()
      if (isBootstrapTopic(args.topic)) {
        const res = await readProjectMemoryBootstrap(projectRoot, exec.signal)
        return {
          topic: 'memory',
          exists: res.exists,
          content: res.content,
        }
      }
      const res = await readTopicMemory(projectRoot, args.topic, exec.signal)
      return {
        topic: res.topic,
        exists: res.exists,
        content: res.content,
      }
    } catch {
      rethrowCancellation(exec.signal)
      sanitizeToolError('read', args.topic)
    }
  },
})

const memoryWriteTool = defineTool({
  name: 'memory_write',
  description:
    'Create or replace one durable project topic memory. Use exact topic identifiers matching ## Memory map or a new lowercase topic name. Special topic="memory" updates the bootstrap summary MEMORY.md. Do not pass filenames (e.g. MEMORY.md) or filesystem paths. Store only durable decisions, constraints, or workflows; never secrets or transient logs.',
  parameters: {
    topic: {
      type: 'string',
      description:
        'Lowercase topic identifier (without .md), or special "memory" for bootstrap summary MEMORY.md. Do not pass filenames or paths.',
      required: true,
    },
    content: {
      type: 'string',
      description: 'Durable markdown content to write for this topic (must not exceed 256 KiB).',
      required: true,
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', required: true },
        created: { type: 'boolean', required: true },
        bytes_written: { type: 'integer', required: true },
      },
      additionalProperties: false,
    },
    render(_args, value) {
      const action = value.created ? 'Created' : 'Updated'
      return [{ type: 'text', text: `${action} topic memory "${value.topic}" (${value.bytes_written} bytes).` }]
    },
  },
  async execute(args, exec) {
    exec.signal.throwIfAborted()
    try {
      const projectRoot = await projectRootFromToolExecution(exec)
      await recoverPendingProjectMemoryTransaction(projectRoot, exec.signal)
      exec.signal.throwIfAborted()
      if (isBootstrapTopic(args.topic)) {
        const res = await writeProjectMemoryBootstrap(projectRoot, args.content, exec.signal)
        const bytesWritten = Buffer.byteLength(args.content, 'utf8')
        return {
          topic: 'memory',
          created: res.created,
          bytes_written: bytesWritten,
        }
      }
      const res = await writeTopicMemoryWithMap(projectRoot, args.topic, args.content, exec.signal)
      const bytesWritten = Buffer.byteLength(args.content, 'utf8')
      return {
        topic: res.topic,
        created: res.created,
        bytes_written: bytesWritten,
      }
    } catch {
      rethrowCancellation(exec.signal)
      sanitizeToolError('write', args.topic)
    }
  },
})

const memoryEditTool = defineTool({
  name: 'memory_edit',
  description:
    'Make one deterministic exact-text edit to an existing durable project topic memory. Use exact topic identifiers listed in ## Memory map, or special topic="memory" for bootstrap summary MEMORY.md. Do not pass filenames (e.g. MEMORY.md) or filesystem paths.',
  parameters: {
    topic: {
      type: 'string',
      description:
        'Topic identifier from ## Memory map, or special "memory" for bootstrap summary MEMORY.md. Do not pass filenames or paths.',
      required: true,
    },
    old_text: {
      type: 'string',
      description: 'Exact text segment within the topic memory to replace. Must match exactly once.',
      required: true,
    },
    new_text: {
      type: 'string',
      description: 'New text segment to replace old_text with.',
      required: true,
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', required: true },
        bytes_written: { type: 'integer', required: true },
      },
      additionalProperties: false,
    },
    render(_args, value) {
      return [{ type: 'text', text: `Updated topic memory "${value.topic}" (${value.bytes_written} bytes).` }]
    },
  },
  async execute(args, exec) {
    exec.signal.throwIfAborted()
    try {
      const projectRoot = await projectRootFromToolExecution(exec)
      await recoverPendingProjectMemoryTransaction(projectRoot, exec.signal)
      exec.signal.throwIfAborted()
      if (isBootstrapTopic(args.topic)) {
        const res = await editProjectMemoryBootstrap(projectRoot, args.old_text, args.new_text, exec.signal)
        return {
          topic: 'memory',
          bytes_written: res.bytesWritten,
        }
      }
      const res = await editTopicMemoryWithMap(projectRoot, args.topic, args.old_text, args.new_text, exec.signal)
      return {
        topic: res.topic,
        bytes_written: res.bytesWritten,
      }
    } catch {
      rethrowCancellation(exec.signal)
      sanitizeToolError('edit', args.topic)
    }
  },
})

export const name = 'project-memory'
export const inject = ['tools', 'agents']
export function apply(ctx: Context): void {
  ctx.tools.register(memoryReadTool)
  ctx.tools.register(memoryWriteTool)
  ctx.tools.register(memoryEditTool)
  registerProjectContextRuntime(ctx)
  registerMemoryCommands(ctx)
}
