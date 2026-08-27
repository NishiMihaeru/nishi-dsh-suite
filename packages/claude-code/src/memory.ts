import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const CLAUDE_MEMORY_SERVER_NAME = 'dsh-memory'
export const CLAUDE_MEMORY_ALLOWED_TOOL = 'mcp__dsh-memory__memory_read'
const MAX_MCP_REQUEST_BYTES = 1024 * 1024

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

export interface ClaudeSubagentMemory {
  readonly bootstrap: string | null
  readonly context: SubagentProjectContextLike
  readonly allowedTool: string
}

export interface ClaudeMemoryMcpBridge {
  readonly url: string
  readonly token: string
  readonly mcpConfig: string
  readonly allowedTool: string
  close(): Promise<void>
}

export async function runClaudeMemoryRead(
  context: SubagentProjectContextLike,
  topic: string,
  signal?: AbortSignal,
): Promise<any> {
  try {
    const result = await context.readTopic(topic, signal)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    }
  } catch {
    return {
      content: [{ type: 'text' as const, text: 'DSH project memory read failed.' }],
      isError: true,
    }
  }
}

export function createClaudeSubagentMemoryFromContext(
  context: SubagentProjectContextLike,
): ClaudeSubagentMemory {
  return {
    bootstrap: context.renderedBootstrap,
    context,
    allowedTool: CLAUDE_MEMORY_ALLOWED_TOOL,
  }
}

export async function createClaudeSubagentMemory(
  service: ProjectMemoryServiceLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<ClaudeSubagentMemory> {
  const context = await service.createSubagentContext({ cwd, signal })
  return createClaudeSubagentMemoryFromContext(context)
}

export function claudePromptWithProjectMemory(
  task: string,
  bootstrap: string | null | undefined,
): string {
  if (bootstrap === null || bootstrap === undefined || bootstrap.length === 0) return task
  return `${bootstrap}\n\n# Delegated Task\n\n${task}`
}

export function claudeMemoryMcpConfig(url: string, token: string): string {
  return JSON.stringify({
    mcpServers: {
      [CLAUDE_MEMORY_SERVER_NAME]: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  })
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_MCP_REQUEST_BYTES) throw new Error('request too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function toolDescriptor() {
  return {
    name: 'memory_read',
    description: 'Read one DSH-owned durable project memory topic. Read-only; paths and filenames are not accepted.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { topic: { type: 'string' } },
      required: ['topic'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }
}

/** Start one authenticated loopback-only Streamable HTTP MCP endpoint for a run. */
export async function startClaudeMemoryMcpBridge(
  context: SubagentProjectContextLike,
  parentSignal?: AbortSignal,
): Promise<ClaudeMemoryMcpBridge> {
  const token = randomBytes(32).toString('hex')
  const server = createServer(async (req, res) => {
    try {
      if (req.url !== '/mcp') {
        res.statusCode = 404
        res.end()
        return
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401
        res.end()
        return
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Allow', 'POST')
        res.end()
        return
      }

      const message = record(await readJson(req))
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        sendJson(res, 400, { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } })
        return
      }

      const id = message.id
      if (id === undefined) {
        res.statusCode = 202
        res.end()
        return
      }

      if (message.method === 'initialize') {
        const params = record(message.params)
        const requestedVersion = typeof params?.protocolVersion === 'string'
          ? params.protocolVersion
          : '2025-06-18'
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: requestedVersion,
            capabilities: { tools: {} },
            serverInfo: { name: CLAUDE_MEMORY_SERVER_NAME, version: '0.1.0' },
          },
        })
        return
      }

      if (message.method === 'ping') {
        sendJson(res, 200, { jsonrpc: '2.0', id, result: {} })
        return
      }

      if (message.method === 'tools/list') {
        sendJson(res, 200, { jsonrpc: '2.0', id, result: { tools: [toolDescriptor()] } })
        return
      }

      if (message.method === 'tools/call') {
        const params = record(message.params)
        const args = record(params?.arguments)
        if (params?.name !== 'memory_read' || typeof args?.topic !== 'string') {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'DSH project memory read failed.' }],
              isError: true,
            },
          })
          return
        }
        const result = await runClaudeMemoryRead(context, args.topic, parentSignal)
        sendJson(res, 200, { jsonrpc: '2.0', id, result })
        return
      }

      sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      })
    } catch {
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal error' },
        })
      } else {
        res.end()
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('subagent-claude-code: failed to bind project memory bridge')
  }

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    parentSignal?.removeEventListener('abort', onAbort)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const onAbort = () => { void close() }
  parentSignal?.addEventListener('abort', onAbort, { once: true })

  const url = `http://127.0.0.1:${address.port}/mcp`
  return {
    url,
    token,
    mcpConfig: claudeMemoryMcpConfig(url, token),
    allowedTool: CLAUDE_MEMORY_ALLOWED_TOOL,
    close,
  }
}
