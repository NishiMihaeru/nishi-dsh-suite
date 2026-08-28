import { join } from 'node:path'
import {
  withSafeDirectoryScope,
  type SafeDirectoryScope,
} from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'

export interface ProjectStorageScopes {
  readonly dsh: SafeDirectoryScope
  readonly memory: SafeDirectoryScope
  readonly local: SafeDirectoryScope
}

export async function withExistingProjectDshScope<T>(
  projectRoot: string,
  operation: (dshScope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  return withSafeDirectoryScope(
    paths.projectRoot,
    (rootScope) => rootScope.withExistingChildDirectory(dshDir, operation),
    signal,
    { allowDirectorySymlink: true },
  )
}

export async function withEnsuredProjectDshScope<T>(
  projectRoot: string,
  operation: (dshScope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  return withSafeDirectoryScope(
    paths.projectRoot,
    (rootScope) => rootScope.withEnsuredChildDirectory(dshDir, operation),
    signal,
    { allowDirectorySymlink: true },
  )
}

export async function withExistingProjectMemoryScope<T>(
  projectRoot: string,
  operation: (memoryScope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  return withExistingProjectDshScope(
    projectRoot,
    (dshScope) => dshScope.withExistingChildDirectory(paths.memoryDir, operation),
    signal,
  )
}

export async function withEnsuredProjectMemoryScope<T>(
  projectRoot: string,
  operation: (memoryScope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  return withEnsuredProjectDshScope(
    projectRoot,
    (dshScope) => dshScope.withEnsuredChildDirectory(paths.memoryDir, operation),
    signal,
  )
}

export async function withExistingProjectLocalScope<T>(
  projectRoot: string,
  operation: (localScope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  return withExistingProjectDshScope(
    projectRoot,
    (dshScope) => dshScope.withExistingChildDirectory(paths.localDir, operation),
    signal,
  )
}

export async function withEnsuredProjectLocalScope<T>(
  projectRoot: string,
  operation: (localScope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  return withEnsuredProjectDshScope(
    projectRoot,
    (dshScope) => dshScope.withEnsuredChildDirectory(paths.localDir, operation),
    signal,
  )
}

export async function withEnsuredProjectStorageScopes<T>(
  projectRoot: string,
  operation: (scopes: ProjectStorageScopes) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  return withEnsuredProjectDshScope(projectRoot, async (dshScope) => {
    return dshScope.withEnsuredChildDirectory(paths.memoryDir, async (memoryScope) => {
      return dshScope.withEnsuredChildDirectory(paths.localDir, async (localScope) => {
        return operation({ dsh: dshScope, memory: memoryScope, local: localScope })
      })
    })
  }, signal)
}
