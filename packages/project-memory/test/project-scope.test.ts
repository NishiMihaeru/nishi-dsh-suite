import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { resolveProjectMemoryPaths } from '../src/paths.js'

 test('project memory paths stay inside the explicit project root', () => {
  const projectRoot = resolve('fixture-project')
  const paths = resolveProjectMemoryPaths(projectRoot)

  assert.equal(paths.projectRoot, projectRoot)
  assert.equal(paths.dshMd, join(projectRoot, 'DSH.md'))
  assert.equal(paths.projectJson, join(projectRoot, '.dsh', 'project.json'))
  assert.equal(paths.memoryDir, join(projectRoot, '.dsh', 'memory'))
  assert.equal(paths.memoryMd, join(projectRoot, '.dsh', 'memory', 'MEMORY.md'))
  assert.equal(paths.localDir, join(projectRoot, '.dsh', 'local'))

  for (const path of Object.values(paths)) {
    assert.equal(path.startsWith(projectRoot), true)
  }
})
