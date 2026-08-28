import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  apply,
  resolveProjectMemoryPaths,
  writeProjectMemoryBootstrap,
} from '../src/index.js'

async function withTempProject(fn: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-memory-tools-test-'))
  try {
    await fn(projectRoot)
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
}

function captureTools(): Map<string, any> {
  const tools = new Map<string, any>()
  const ctx = {
    tools: {
      register(tool: any) {
        tools.set(tool.name, tool)
      },
    },
    on() {
      return () => {}
    },
    inject() {},
  }
  apply(ctx as any)
  return tools
}

function execution(projectRoot: string): any {
  return {
    signal: new AbortController().signal,
    agent: {
      session: {
        header: { cwd: projectRoot },
      },
    },
  }
}

test('model-facing memory_write and memory_edit keep a named topic and Memory map consistent', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    const tools = captureTools()
    const writeTool = tools.get('memory_write')
    const editTool = tools.get('memory_edit')
    assert.ok(writeTool)
    assert.ok(editTool)

    const writeResult = await writeTool.execute(
      { topic: 'architecture', content: 'state=old\n' },
      execution(projectRoot),
    )
    assert.deepEqual(writeResult, {
      topic: 'architecture',
      created: true,
      bytes_written: Buffer.byteLength('state=old\n'),
    })

    const editResult = await editTool.execute(
      { topic: 'architecture', old_text: 'old', new_text: 'new' },
      execution(projectRoot),
    )
    assert.deepEqual(editResult, {
      topic: 'architecture',
      bytes_written: Buffer.byteLength('state=new\n'),
    })

    assert.equal(await readFile(join(paths.memoryDir, 'architecture.md'), 'utf8'), 'state=new\n')
    const memory = await readFile(paths.memoryMd, 'utf8')
    assert.equal((memory.match(/`architecture`/g) ?? []).length, 1)
  })
})

test('model-facing memory_write reports sanitized failure without creating a topic when Memory map preflight fails', async () => {
  await withTempProject(async (projectRoot) => {
    const paths = resolveProjectMemoryPaths(projectRoot)
    await writeProjectMemoryBootstrap(
      projectRoot,
      '# Project Memory\n\n## Memory map\nNo topic memories yet.\n\n## Memory map\nDuplicate section.\n',
    )
    const tools = captureTools()
    const writeTool = tools.get('memory_write')
    assert.ok(writeTool)

    await assert.rejects(
      () => writeTool.execute(
        { topic: 'architecture', content: 'must-not-persist\n' },
        execution(projectRoot),
      ),
      /^Project memory write failed for topic "architecture"\.$/,
    )

    await assert.rejects(() => readFile(join(paths.memoryDir, 'architecture.md'), 'utf8'), (error: any) => {
      assert.equal(error?.code, 'ENOENT')
      return true
    })
  })
})
