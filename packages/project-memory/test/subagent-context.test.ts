import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as projectMemory from '../src/index.js'

async function withProject(fn: (root: string, nested: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-subagent-memory-'))
  const nested = join(root, 'packages', 'worker')
  try {
    await mkdir(join(root, '.git'), { recursive: true })
    await mkdir(nested, { recursive: true })
    await fn(root, nested)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function seedMemory(root: string): Promise<void> {
  await mkdir(join(root, '.dsh', 'memory'), { recursive: true })
  await writeFile(join(root, 'DSH.md'), '# Project Contract\nKeep DSH authoritative.\n', 'utf8')
  await writeFile(
    join(root, '.dsh', 'memory', 'MEMORY.md'),
    '# Project Memory\n\n## Memory map\n- architecture\n',
    'utf8',
  )
  await writeFile(
    join(root, '.dsh', 'memory', 'architecture.md'),
    '# Architecture\nCurrent durable decision.\n',
    'utf8',
  )
}

test('exports the provider-neutral subagent project context API', () => {
  assert.equal(typeof (projectMemory as any).createSubagentProjectContext, 'function')
})

test('discovers project root and renders DSH.md plus MEMORY.md with read-only guidance', async () => {
  await withProject(async (root, nested) => {
    await seedMemory(root)

    const context = await (projectMemory as any).createSubagentProjectContext({ cwd: nested })

    assert.equal(context.projectRoot, root)
    assert.match(context.renderedBootstrap, /# DSH Project Context/)
    assert.match(context.renderedBootstrap, /## Project Contract \(DSH\.md\)/)
    assert.match(context.renderedBootstrap, /Keep DSH authoritative\./)
    assert.match(context.renderedBootstrap, /## Project Memory \(\.dsh\/memory\/MEMORY\.md\)/)
    assert.match(context.renderedBootstrap, /memory_read/)
    assert.match(context.renderedBootstrap, /read-only/i)
    assert.doesNotMatch(context.renderedBootstrap, /memory_write/)
    assert.doesNotMatch(context.renderedBootstrap, /memory_edit/)
  })
})

test('returns null bootstrap when DSH.md and MEMORY.md are both absent', async () => {
  await withProject(async (_root, nested) => {
    const context = await (projectMemory as any).createSubagentProjectContext({ cwd: nested })
    assert.equal(context.renderedBootstrap, null)
  })
})

test('reads current topic memory lazily and observes later durable changes', async () => {
  await withProject(async (root, nested) => {
    await seedMemory(root)
    const context = await (projectMemory as any).createSubagentProjectContext({ cwd: nested })

    assert.deepEqual(await context.readTopic('architecture'), {
      topic: 'architecture',
      exists: true,
      content: '# Architecture\nCurrent durable decision.\n',
    })

    await writeFile(
      join(root, '.dsh', 'memory', 'architecture.md'),
      '# Architecture\nUpdated after child startup.\n',
      'utf8',
    )

    assert.deepEqual(await context.readTopic('architecture'), {
      topic: 'architecture',
      exists: true,
      content: '# Architecture\nUpdated after child startup.\n',
    })
  })
})

test('supports special topic memory and valid missing topics', async () => {
  await withProject(async (root, nested) => {
    await seedMemory(root)
    const context = await (projectMemory as any).createSubagentProjectContext({ cwd: nested })

    assert.deepEqual(await context.readTopic('memory'), {
      topic: 'memory',
      exists: true,
      content: '# Project Memory\n\n## Memory map\n- architecture\n',
    })
    assert.deepEqual(await context.readTopic('missing-topic'), {
      topic: 'missing-topic',
      exists: false,
      content: null,
    })
  })
})

test('rejects arbitrary paths and sanitizes provider-facing errors', async () => {
  await withProject(async (root, nested) => {
    await seedMemory(root)
    const context = await (projectMemory as any).createSubagentProjectContext({ cwd: nested })

    for (const topic of ['../secret', 'architecture.md', '/tmp/secret', 'A']) {
      await assert.rejects(
        () => context.readTopic(topic),
        (error: any) => {
          assert.ok(error instanceof Error)
          assert.match(error.message, /Subagent project memory read failed/)
          assert.ok(!error.message.includes(root))
          assert.ok(!error.message.includes('/tmp/secret'))
          return true
        },
      )
    }
  })
})

test('propagates an already-aborted signal without converting it to a sanitized read error', async () => {
  await withProject(async (root, nested) => {
    await seedMemory(root)
    const context = await (projectMemory as any).createSubagentProjectContext({ cwd: nested })
    const controller = new AbortController()
    const reason = new Error('cancelled-by-parent')
    controller.abort(reason)

    await assert.rejects(() => context.readTopic('architecture', controller.signal), reason)
  })
})

test('fails closed on unsafe topic symlink without leaking the project path', async (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink creation is not reliably available in Windows hosted CI')
    return
  }

  await withProject(async (root, nested) => {
    await seedMemory(root)
    const external = join(root, 'outside.txt')
    await writeFile(external, 'do not expose', 'utf8')
    await rm(join(root, '.dsh', 'memory', 'architecture.md'))
    await symlink(external, join(root, '.dsh', 'memory', 'architecture.md'))

    const context = await (projectMemory as any).createSubagentProjectContext({ cwd: nested })
    await assert.rejects(
      () => context.readTopic('architecture'),
      (error: any) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /Subagent project memory read failed/)
        assert.ok(!error.message.includes(root))
        assert.ok(!error.message.includes(external))
        assert.ok(!error.message.includes('do not expose'))
        return true
      },
    )
  })
})
