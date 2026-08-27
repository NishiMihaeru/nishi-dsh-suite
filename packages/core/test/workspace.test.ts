import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ephemeralAgentWorkspace } from '../src/runtime/workspace.ts'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

test('ephemeralAgentWorkspace writes the agent.md tree under a fresh temp root', async () => {
  const workspace = await ephemeralAgentWorkspace({
    prefix: 'dsh-core-test-',
    agentName: 'dsh-subagent',
    agentMarkdown: '---\nname: dsh-subagent\n---\nhello\n',
  })

  try {
    assert.equal(workspace.agentDir, join(workspace.root, '.agents', 'agents', 'dsh-subagent'))
    assert.equal(workspace.agentMarkdownPath, join(workspace.agentDir, 'agent.md'))
    assert.equal(
      await readFile(workspace.agentMarkdownPath, 'utf8'),
      '---\nname: dsh-subagent\n---\nhello\n',
    )
    assert.deepEqual(workspace.files, {})
  } finally {
    await workspace.dispose()
  }

  assert.equal(await exists(workspace.root), false)
})

test('ephemeralAgentWorkspace writes nested root-relative files using portable forward-slash paths', async () => {
  const workspace = await ephemeralAgentWorkspace({
    prefix: 'dsh-core-test-',
    agentName: 'dsh-web-search',
    agentMarkdown: 'agent markdown',
    files: [
      { path: 'schemas/search-output.schema.json', content: '{"type":"object"}' },
    ],
  })

  try {
    const schemaPath = workspace.files['schemas/search-output.schema.json']
    assert.ok(schemaPath)
    assert.equal(schemaPath, join(workspace.root, 'schemas', 'search-output.schema.json'))
    assert.equal(await readFile(schemaPath!, 'utf8'), '{"type":"object"}')
  } finally {
    await workspace.dispose()
  }
})

test('ephemeralAgentWorkspace dispose is idempotent and safe to call more than once', async () => {
  const workspace = await ephemeralAgentWorkspace({
    prefix: 'dsh-core-test-',
    agentName: 'dsh-primary',
    agentMarkdown: 'agent markdown',
  })

  await workspace.dispose()
  await workspace.dispose()

  assert.equal(await exists(workspace.root), false)
})

test('ephemeralAgentWorkspace removes the temp root when filesystem provisioning fails partway', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-core-parent-'))
  try {
    await assert.rejects(
      ephemeralAgentWorkspace({
        prefix: 'dsh-core-test-',
        agentName: 'dsh-subagent',
        agentMarkdown: 'agent markdown',
        files: [
          { path: 'conflict', content: 'a file blocks the next directory' },
          { path: 'conflict/child.txt', content: 'cannot be created below a file' },
        ],
        tmpdir: () => parent,
      }),
    )

    assert.deepEqual(
      await readdir(parent),
      [],
      'a failed provisioning must remove the partially-created workspace root',
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('ephemeralAgentWorkspace rejects an unsafe prefix before touching the filesystem', async () => {
  for (const prefix of ['../escape-', '..\\escape-', '/tmp/escape-', 'C:\\escape-']) {
    let tmpdirCalls = 0
    await assert.rejects(
      ephemeralAgentWorkspace({
        prefix,
        agentName: 'dsh-primary',
        agentMarkdown: 'agent markdown',
        tmpdir: () => {
          tmpdirCalls += 1
          return tmpdir()
        },
      }),
      /spec\.prefix/,
    )
    assert.equal(tmpdirCalls, 0, `unsafe prefix ${JSON.stringify(prefix)} must fail before mkdtemp`)
  }
})

test('ephemeralAgentWorkspace rejects an unsafe agentName before touching the filesystem', async () => {
  for (const agentName of ['..', '.', '../escape', 'nested/name', 'nested\\name']) {
    let tmpdirCalls = 0
    await assert.rejects(
      ephemeralAgentWorkspace({
        prefix: 'dsh-core-test-',
        agentName,
        agentMarkdown: 'agent markdown',
        tmpdir: () => {
          tmpdirCalls += 1
          return tmpdir()
        },
      }),
      /spec\.agentName/,
    )
    assert.equal(tmpdirCalls, 0, `unsafe agentName ${JSON.stringify(agentName)} must fail before mkdtemp`)
  }
})

test('ephemeralAgentWorkspace rejects escaping or non-portable extra file paths before touching the filesystem', async () => {
  const paths = [
    '../escaped.txt',
    'nested/../../escaped.txt',
    '..\\escaped.txt',
    '/tmp/escaped.txt',
    'C:\\escaped.txt',
    './schema.json',
    'nested//schema.json',
  ]

  for (const path of paths) {
    let tmpdirCalls = 0
    await assert.rejects(
      ephemeralAgentWorkspace({
        prefix: 'dsh-core-test-',
        agentName: 'dsh-primary',
        agentMarkdown: 'agent markdown',
        files: [{ path, content: 'must not be written' }],
        tmpdir: () => {
          tmpdirCalls += 1
          return tmpdir()
        },
      }),
      /workspace file\.path/,
    )
    assert.equal(tmpdirCalls, 0, `unsafe file path ${JSON.stringify(path)} must fail before mkdtemp`)
  }
})

test('ephemeralAgentWorkspace rejects a missing agentName before touching the filesystem', async () => {
  let tmpdirCalls = 0
  await assert.rejects(
    ephemeralAgentWorkspace({
      prefix: 'dsh-core-test-',
      agentName: '',
      agentMarkdown: 'agent markdown',
      tmpdir: () => {
        tmpdirCalls += 1
        return tmpdir()
      },
    }),
    /spec\.agentName must be a non-empty string/,
  )
  assert.equal(tmpdirCalls, 0)
})
