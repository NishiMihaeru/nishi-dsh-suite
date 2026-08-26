import assert from 'node:assert/strict'
import test from 'node:test'
import {
  claudeCliArgv,
  textTask,
} from '../src/run.js'

test('textTask validates one-shot prompt content', () => {
  assert.throws(
    () => textTask([]),
    /one-shot task must contain only text blocks/i,
  )
  assert.throws(
    () => textTask([{ type: 'image' } as any]),
    /one-shot task must contain only text blocks/i,
  )
  assert.throws(
    () => textTask([{ type: 'text', text: '   \n\t  ' }]),
    /one-shot task must not be empty/i,
  )
  assert.equal(
    textTask([
      { type: 'text', text: 'alpha ' },
      { type: 'text', text: 'beta' },
    ]),
    'alpha beta',
  )
})

test('direct Claude CLI argv preserves unattended one-shot defaults', () => {
  assert.deepEqual(
    claudeCliArgv({
      executable: '/home/user/.local/bin/claude',
      model: 'claude-sonnet-5',
      effort: 'high',
      permissionMode: 'auto',
      prompt: 'delegated task',
    }),
    [
      '/home/user/.local/bin/claude',
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--no-session-persistence',
      '--model', 'claude-sonnet-5',
      '--effort', 'high',
      '--permission-mode', 'auto',
      '--disallowedTools', 'AskUserQuestion',
      'delegated task',
    ],
  )
})

test('plan mode also disallows ExitPlanMode so unattended runs cannot block', () => {
  const argv = claudeCliArgv({
    executable: '/usr/bin/claude',
    model: 'claude-sonnet-5',
    effort: 'high',
    permissionMode: 'plan',
    prompt: 'delegated task',
  })

  const toolsIndex = argv.indexOf('--disallowedTools')
  assert.ok(toolsIndex >= 0)
  assert.equal(argv[toolsIndex + 1], 'AskUserQuestion,ExitPlanMode')
})

test('bypassPermissions stays an explicit CLI permission mode', () => {
  const argv = claudeCliArgv({
    executable: '/usr/bin/claude',
    model: 'claude-sonnet-5',
    effort: 'high',
    permissionMode: 'bypassPermissions',
    prompt: 'delegated task',
  })

  const modeIndex = argv.indexOf('--permission-mode')
  assert.ok(modeIndex >= 0)
  assert.equal(argv[modeIndex + 1], 'bypassPermissions')
})

test('memory bridge is supplied only through the per-run MCP CLI seam', () => {
  const mcpConfig = JSON.stringify({
    mcpServers: {
      'dsh-memory': {
        type: 'http',
        url: 'http://127.0.0.1:45678/mcp',
        headers: { Authorization: 'Bearer ephemeral-token' },
      },
    },
  })

  const argv = claudeCliArgv({
    executable: '/usr/bin/claude',
    model: 'claude-sonnet-5',
    effort: 'high',
    permissionMode: 'auto',
    prompt: 'delegated task',
    memory: {
      mcpConfig,
      allowedTool: 'mcp__dsh-memory__memory_read',
    },
  })

  const mcpIndex = argv.indexOf('--mcp-config')
  assert.ok(mcpIndex >= 0)
  assert.equal(argv[mcpIndex + 1], mcpConfig)
  const allowedIndex = argv.indexOf('--allowedTools')
  assert.ok(allowedIndex >= 0)
  assert.equal(argv[allowedIndex + 1], 'mcp__dsh-memory__memory_read')
})
