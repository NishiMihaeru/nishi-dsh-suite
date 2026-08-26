import { join, resolve } from 'node:path'

export interface ProjectMemoryPaths {
  projectRoot: string
  dshMd: string
  projectJson: string
  memoryDir: string
  memoryMd: string
  localDir: string
}

/**
 * Deterministically resolves canonical project memory filesystem paths from an explicit projectRoot.
 *
 * Canonical locations:
 * - PROJECT/DSH.md (project contract)
 * - PROJECT/.dsh/project.json (metadata)
 * - PROJECT/.dsh/memory/ (committed topic memory)
 * - PROJECT/.dsh/memory/MEMORY.md (always-loaded bootstrap)
 * - PROJECT/.dsh/local/ (uncommitted runtime state)
 */
export function resolveProjectMemoryPaths(projectRoot: string): ProjectMemoryPaths {
  const root = resolve(projectRoot)
  return {
    projectRoot: root,
    dshMd: join(root, 'DSH.md'),
    projectJson: join(root, '.dsh', 'project.json'),
    memoryDir: join(root, '.dsh', 'memory'),
    memoryMd: join(root, '.dsh', 'memory', 'MEMORY.md'),
    localDir: join(root, '.dsh', 'local'),
  }
}
