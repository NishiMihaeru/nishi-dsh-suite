import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NISHI_DSH_SUITE_VERSION } from './index.js'

const PRESET_ID = 'orchestrator'
const USER_PRESET_DIR = '.agent-presets'
const MARKER_FILE = '.nishi-dsh-suite-preset.json'
const MARKER_OWNER = 'nishi-dsh-suite'
const MARKER_SCHEMA_VERSION = 1
const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../presets/orchestrator/', import.meta.url))

type FileManifest = Record<string, string>

interface ManagedPresetMarker {
  schemaVersion: 1
  owner: typeof MARKER_OWNER
  preset: typeof PRESET_ID
  suiteVersion: string
  files: FileManifest
}

export type OrchestratorPresetState = 'absent' | 'unmanaged' | 'modified' | 'outdated' | 'current'

export interface OrchestratorPresetOptions {
  dshHome?: string
  sourceRoot?: string
  suiteVersion?: string
}

export interface OrchestratorPresetResult {
  state: OrchestratorPresetState
  changed: boolean
  target: string
}

interface ResolvedOptions {
  dshHome: string
  sourceRoot: string
  suiteVersion: string
  userRoot: string
  target: string
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function resolveDshHome(configured?: string): string {
  const fromEnv = process.env.DSH_HOME
  const selected = configured ?? (
    fromEnv !== undefined && fromEnv.trim().length > 0
      ? fromEnv
      : join(homedir(), '.dsh')
  )
  return resolve(expandHomePath(selected))
}

function resolveOptions(options: OrchestratorPresetOptions = {}): ResolvedOptions {
  const dshHome = resolveDshHome(options.dshHome)
  const userRoot = join(dshHome, USER_PRESET_DIR)
  return {
    dshHome,
    userRoot,
    target: join(userRoot, PRESET_ID),
    sourceRoot: resolve(options.sourceRoot ?? DEFAULT_SOURCE_ROOT),
    suiteVersion: options.suiteVersion ?? NISHI_DSH_SUITE_VERSION,
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

async function pathKind(path: string): Promise<'missing' | 'directory' | 'other'> {
  try {
    const entry = await lstat(path)
    if (entry.isDirectory() && !entry.isSymbolicLink()) return 'directory'
    return 'other'
  } catch (error) {
    if (isMissing(error)) return 'missing'
    throw error
  }
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function collectManifest(root: string): Promise<FileManifest> {
  const files: Array<[string, string]> = []

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (prefix.length === 0 && entry.name === MARKER_FILE) continue
      const source = join(directory, entry.name)
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      const sourceStat = await lstat(source)

      if (sourceStat.isSymbolicLink()) {
        throw new Error(`preset contains a symbolic link and is unsafe to manage: ${relative}`)
      }
      if (sourceStat.isDirectory()) {
        await walk(source, relative)
        continue
      }
      if (!sourceStat.isFile()) {
        throw new Error(`preset contains an unsupported filesystem entry: ${relative}`)
      }

      files.push([relative, sha256(await readFile(source))])
    }
  }

  await walk(root, '')
  return Object.fromEntries(files)
}

function sameManifest(left: FileManifest, right: FileManifest): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b))
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([path, digest], index) => {
    const other = rightEntries[index]
    return other !== undefined && other[0] === path && other[1] === digest
  })
}

function isFileManifest(value: unknown): value is FileManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(([path, digest]) => {
    return path.length > 0 && typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)
  })
}

function isManagedMarker(value: unknown): value is ManagedPresetMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const marker = value as Partial<ManagedPresetMarker>
  return marker.schemaVersion === MARKER_SCHEMA_VERSION
    && marker.owner === MARKER_OWNER
    && marker.preset === PRESET_ID
    && typeof marker.suiteVersion === 'string'
    && marker.suiteVersion.length > 0
    && isFileManifest(marker.files)
}

async function readManagedMarker(target: string): Promise<ManagedPresetMarker | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(target, MARKER_FILE), 'utf8'))
    return isManagedMarker(parsed) ? parsed : undefined
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function copyPresetTree(sourceRoot: string, targetRoot: string): Promise<void> {
  async function copyDirectory(source: string, target: string): Promise<void> {
    await mkdir(target, { recursive: true, mode: 0o700 })
    await chmod(target, 0o700)

    const entries = await readdir(source, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (source === sourceRoot && entry.name === MARKER_FILE) continue
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      const sourceStat = await lstat(sourcePath)

      if (sourceStat.isSymbolicLink()) {
        throw new Error(`packaged preset contains a symbolic link: ${entry.name}`)
      }
      if (sourceStat.isDirectory()) {
        await copyDirectory(sourcePath, targetPath)
        continue
      }
      if (!sourceStat.isFile()) {
        throw new Error(`packaged preset contains an unsupported filesystem entry: ${entry.name}`)
      }

      const mode = (sourceStat.mode & 0o111) !== 0 ? 0o700 : 0o600
      await writeFile(targetPath, await readFile(sourcePath), { mode })
      await chmod(targetPath, mode)
    }
  }

  await copyDirectory(sourceRoot, targetRoot)
}

async function stageManagedPreset(options: ResolvedOptions): Promise<string> {
  const sourceKind = await pathKind(options.sourceRoot)
  if (sourceKind !== 'directory') {
    throw new Error(`packaged Orchestrator preset is missing: ${options.sourceRoot}`)
  }

  const files = await collectManifest(options.sourceRoot)
  if (!('preset.yml' in files) || !('agent.cordis.yml' in files)) {
    throw new Error('packaged Orchestrator preset is incomplete')
  }

  // DSH owns the user preset root. Create it when absent, but never chmod an
  // existing root or otherwise mutate sibling user presets.
  await mkdir(options.userRoot, { recursive: true, mode: 0o700 })

  const staged = join(options.userRoot, `.${PRESET_ID}.nishi-stage-${randomUUID()}`)
  try {
    await copyPresetTree(options.sourceRoot, staged)
    const marker: ManagedPresetMarker = {
      schemaVersion: MARKER_SCHEMA_VERSION,
      owner: MARKER_OWNER,
      preset: PRESET_ID,
      suiteVersion: options.suiteVersion,
      files,
    }
    await writeFile(join(staged, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 })
    await chmod(join(staged, MARKER_FILE), 0o600)
    return staged
  } catch (error) {
    await rm(staged, { recursive: true, force: true })
    throw error
  }
}

async function installStagedPreset(options: ResolvedOptions, replaceExisting: boolean): Promise<void> {
  const staged = await stageManagedPreset(options)
  if (!replaceExisting) {
    try {
      await rename(staged, options.target)
      return
    } catch (error) {
      await rm(staged, { recursive: true, force: true })
      throw error
    }
  }

  const backup = join(options.userRoot, `.${PRESET_ID}.nishi-backup-${randomUUID()}`)
  try {
    await rename(options.target, backup)
  } catch (error) {
    // Every other exit from this function cleans the stage up; this one did not,
    // so a backup rename that failed on permissions or a lock left a
    // `.nishi-stage-<uuid>` directory behind in the user's preset root forever.
    await rm(staged, { recursive: true, force: true })
    throw error
  }
  try {
    await rename(staged, options.target)
  } catch (error) {
    try {
      await rename(backup, options.target)
    } finally {
      await rm(staged, { recursive: true, force: true })
    }
    throw error
  }
  await rm(backup, { recursive: true, force: true })
}

export async function inspectOrchestratorPreset(
  input: OrchestratorPresetOptions = {},
): Promise<OrchestratorPresetResult> {
  const options = resolveOptions(input)
  const targetKind = await pathKind(options.target)
  if (targetKind === 'missing') return { state: 'absent', changed: false, target: options.target }
  if (targetKind !== 'directory') return { state: 'unmanaged', changed: false, target: options.target }

  const marker = await readManagedMarker(options.target)
  if (marker === undefined) return { state: 'unmanaged', changed: false, target: options.target }

  let installedFiles: FileManifest
  try {
    installedFiles = await collectManifest(options.target)
  } catch {
    return { state: 'modified', changed: false, target: options.target }
  }
  if (!sameManifest(installedFiles, marker.files)) {
    return { state: 'modified', changed: false, target: options.target }
  }

  const packagedFiles = await collectManifest(options.sourceRoot)
  const current = marker.suiteVersion === options.suiteVersion && sameManifest(marker.files, packagedFiles)
  return { state: current ? 'current' : 'outdated', changed: false, target: options.target }
}

function unmanagedError(target: string): Error {
  return new Error(`Orchestrator preset at ${target} is not managed by nishi-dsh-suite; refusing to overwrite or remove it.`)
}

function modifiedError(target: string): Error {
  return new Error(`Orchestrator preset at ${target} is locally modified; refusing to overwrite or remove local changes.`)
}

export async function installOrchestratorPreset(
  input: OrchestratorPresetOptions = {},
): Promise<OrchestratorPresetResult> {
  const options = resolveOptions(input)
  const status = await inspectOrchestratorPreset(input)

  if (status.state === 'current') return status
  if (status.state === 'unmanaged') throw unmanagedError(status.target)
  if (status.state === 'modified') throw modifiedError(status.target)
  if (status.state === 'outdated') {
    throw new Error(`Orchestrator preset at ${status.target} is managed but outdated; run "nishi-dsh-suite preset update".`)
  }

  await installStagedPreset(options, false)
  return { state: 'current', changed: true, target: options.target }
}

export async function updateOrchestratorPreset(
  input: OrchestratorPresetOptions = {},
): Promise<OrchestratorPresetResult> {
  const options = resolveOptions(input)
  const status = await inspectOrchestratorPreset(input)

  if (status.state === 'current') return status
  if (status.state === 'absent') {
    throw new Error(`Orchestrator preset is not installed at ${status.target}; run "nishi-dsh-suite preset install".`)
  }
  if (status.state === 'unmanaged') throw unmanagedError(status.target)
  if (status.state === 'modified') throw modifiedError(status.target)

  await installStagedPreset(options, true)
  return { state: 'current', changed: true, target: options.target }
}

export async function removeOrchestratorPreset(
  input: OrchestratorPresetOptions = {},
): Promise<OrchestratorPresetResult> {
  const status = await inspectOrchestratorPreset(input)
  if (status.state === 'absent') return status
  if (status.state === 'unmanaged') throw unmanagedError(status.target)
  if (status.state === 'modified') throw modifiedError(status.target)

  await rm(status.target, { recursive: true, force: false })
  return { state: 'absent', changed: true, target: status.target }
}
