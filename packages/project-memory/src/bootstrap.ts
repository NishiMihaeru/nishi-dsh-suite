import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { ensureCanonicalDirectory, validateCanonicalDirectory, writeSafeFileAtomically } from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { isValidTopicIdentifier } from './topics.js'

export const MAX_BOOTSTRAP_LINES = 200
export const MAX_BOOTSTRAP_BYTES = 25 * 1024

export const INITIAL_MEMORY_MD_CONTENT = `# Project Memory

## Current state
Project initialized in DSH.

## Memory map
No topic memories yet.
`

export interface EnsureProjectMemoryResult {
  created: boolean
  memoryPath: string
}

export interface ReadProjectMemoryResult {
  exists: boolean
  content: string | null
  path: string
}

export interface WriteProjectMemoryBootstrapResult {
  created: boolean
  memoryPath: string
}

export interface EditProjectMemoryBootstrapResult {
  memoryPath: string
  bytesWritten: number
}

export function truncateLines(content: string, maxLines: number): string {
  if (maxLines <= 0) return ''
  let count = 0
  let pos = 0
  while (pos < content.length && count < maxLines) {
    const next = content.indexOf('\n', pos)
    if (next === -1) return content
    count++
    if (count === maxLines) return content.slice(0, next + 1)
    pos = next + 1
  }
  return content
}

export function truncateUtf8Buffer(buf: Buffer, maxBytes: number): Buffer {
  if (buf.length <= maxBytes) return buf
  let end = maxBytes
  while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end--
  if (end === 0) return Buffer.alloc(0)
  const leadByte = buf[end - 1]
  if ((leadByte & 0x80) === 0) return buf.subarray(0, maxBytes)
  let expectedLen = 1
  if ((leadByte & 0xe0) === 0xc0) expectedLen = 2
  else if ((leadByte & 0xf0) === 0xe0) expectedLen = 3
  else if ((leadByte & 0xf8) === 0xf0) expectedLen = 4
  if (end - 1 + expectedLen <= maxBytes) return buf.subarray(0, end - 1 + expectedLen)
  return buf.subarray(0, end - 1)
}

export function boundedUtf8Bootstrap(
  rawBuffer: Buffer,
  maxLines = MAX_BOOTSTRAP_LINES,
  maxBytes = MAX_BOOTSTRAP_BYTES,
): string {
  const fullText = rawBuffer.toString('utf8')
  const lineCapped = truncateLines(fullText, maxLines)
  const lineCappedBuf = Buffer.from(lineCapped, 'utf8')
  if (lineCappedBuf.length <= maxBytes) return lineCapped
  return truncateUtf8Buffer(lineCappedBuf, maxBytes).toString('utf8')
}

function assertBootstrapBounds(content: string): void {
  const buf = Buffer.from(content, 'utf8')
  if (buf.length > MAX_BOOTSTRAP_BYTES) {
    throw new Error(
      `Bootstrap content exceeds maximum size limit of ${MAX_BOOTSTRAP_BYTES} bytes (${buf.length} bytes)`,
    )
  }
  if (truncateLines(content, MAX_BOOTSTRAP_LINES) !== content) {
    throw new Error(`Bootstrap content exceeds maximum line limit of ${MAX_BOOTSTRAP_LINES} lines`)
  }
}

export async function ensureProjectMemoryBootstrap(
  projectRoot: string,
): Promise<EnsureProjectMemoryResult> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  await ensureCanonicalDirectory(dshDir)
  await ensureCanonicalDirectory(memoryDir)
  try {
    const stats = await lstat(memoryMd)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Project memory at "${memoryMd}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
    return { created: false, memoryPath: memoryMd }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }
  try {
    await writeFile(memoryMd, INITIAL_MEMORY_MD_CONTENT, { encoding: 'utf8', flag: 'wx' })
    return { created: true, memoryPath: memoryMd }
  } catch (err: any) {
    if (err?.code === 'EEXIST') {
      const stats = await lstat(memoryMd)
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(
          `Project memory at "${memoryMd}" must be a regular file, not a symbolic link or non-regular entry`,
        )
      }
      return { created: false, memoryPath: memoryMd }
    }
    throw err
  }
}

export async function readProjectMemoryBootstrap(
  projectRoot: string,
): Promise<ReadProjectMemoryResult> {
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  if (!(await validateCanonicalDirectory(dshDir))) return { exists: false, content: null, path: memoryMd }
  if (!(await validateCanonicalDirectory(memoryDir))) return { exists: false, content: null, path: memoryMd }
  let fileStats
  try {
    fileStats = await lstat(memoryMd)
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { exists: false, content: null, path: memoryMd }
    throw err
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new Error(
      `Project memory at "${memoryMd}" must be a regular file, not a symbolic link or non-regular entry`,
    )
  }
  const rawBuffer = await readFile(memoryMd)
  return {
    exists: true,
    content: boundedUtf8Bootstrap(rawBuffer, MAX_BOOTSTRAP_LINES, MAX_BOOTSTRAP_BYTES),
    path: memoryMd,
  }
}

export async function writeProjectMemoryBootstrap(
  projectRoot: string,
  content: string,
): Promise<WriteProjectMemoryBootstrapResult> {
  if (!isAbsolute(projectRoot)) throw new Error(`projectRoot must be an absolute path, received "${projectRoot}"`)
  if (typeof content !== 'string') throw new Error('Project memory bootstrap content must be a string')
  assertBootstrapBounds(content)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  await ensureCanonicalDirectory(dshDir)
  await ensureCanonicalDirectory(memoryDir)
  let created = false
  try {
    const stats = await lstat(memoryMd)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Project memory at "${memoryMd}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') created = true
    else throw err
  }
  await writeSafeFileAtomically(memoryDir, memoryMd, Buffer.from(content, 'utf8'))
  return { created, memoryPath: memoryMd }
}

export async function editProjectMemoryBootstrap(
  projectRoot: string,
  oldText: string,
  newText: string,
): Promise<EditProjectMemoryBootstrapResult> {
  if (!isAbsolute(projectRoot)) throw new Error(`projectRoot must be an absolute path, received "${projectRoot}"`)
  if (typeof oldText !== 'string' || oldText.length === 0) throw new Error('oldText must be a non-empty string')
  if (typeof newText !== 'string') throw new Error('newText must be a string')
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  if (!(await validateCanonicalDirectory(dshDir))) {
    throw new Error(`Cannot edit project memory bootstrap: directory "${dshDir}" does not exist`)
  }
  if (!(await validateCanonicalDirectory(memoryDir))) {
    throw new Error(`Cannot edit project memory bootstrap: directory "${memoryDir}" does not exist`)
  }
  let stats
  try {
    stats = await lstat(memoryMd)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Project memory bootstrap file "${memoryMd}" does not exist; cannot edit missing file`)
    }
    throw err
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(
      `Project memory at "${memoryMd}" must be a regular file, not a symbolic link or non-regular entry`,
    )
  }
  const currentContent = await readFile(memoryMd, 'utf8')
  const firstIndex = currentContent.indexOf(oldText)
  if (firstIndex === -1) {
    throw new Error(`Exact match for oldText not found in project memory bootstrap (${memoryMd})`)
  }
  const secondIndex = currentContent.indexOf(oldText, firstIndex + 1)
  if (secondIndex !== -1) {
    let count = 2
    let pos = secondIndex + 1
    while (pos < currentContent.length) {
      const next = currentContent.indexOf(oldText, pos)
      if (next === -1) break
      count++
      pos = next + 1
    }
    throw new Error(
      `Multiple occurrences (${count}) of oldText found in project memory bootstrap; exact single match required`,
    )
  }
  const updatedContent =
    currentContent.slice(0, firstIndex) + newText + currentContent.slice(firstIndex + oldText.length)
  assertBootstrapBounds(updatedContent)
  const updatedBuffer = Buffer.from(updatedContent, 'utf8')
  await writeSafeFileAtomically(memoryDir, memoryMd, updatedBuffer)
  return { memoryPath: memoryMd, bytesWritten: updatedBuffer.length }
}

const mapMutexes = new Map<string, Promise<void>>()

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function insertTopicIntoMemoryMapContent(content: string, topic: string): string {
  const canonicalEntry = `- \`${topic}\` → \`.dsh/memory/${topic}.md\``
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const mapHeadingIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Memory\s+map\s*$/i.test(lines[i].trim())) mapHeadingIndices.push(i)
  }
  if (mapHeadingIndices.length > 1) {
    throw new Error('Ambiguous multiple "## Memory map" sections found in project memory bootstrap; cannot modify safely')
  }
  if (mapHeadingIndices.length === 0) {
    const trimmedContent = content.trimEnd()
    const separator = trimmedContent.length === 0 ? '' : eol + eol
    return `${trimmedContent}${separator}## Memory map${eol}${eol}${canonicalEntry}${eol}`
  }
  const headingIdx = mapHeadingIndices[0]
  let nextSectionIdx = lines.length
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) {
      nextSectionIdx = i
      break
    }
  }
  const sectionLines = lines.slice(headingIdx + 1, nextSectionIdx)
  const topicMappingRegex = new RegExp(`^\\s*-\\s*\`${escapeRegex(topic)}\`\\s*→`, 'i')
  const matchingIndices: number[] = []
  for (let j = 0; j < sectionLines.length; j++) {
    if (topicMappingRegex.test(sectionLines[j])) matchingIndices.push(j)
  }
  if (matchingIndices.length === 1 && sectionLines[matchingIndices[0]] === canonicalEntry) return content
  if (matchingIndices.length > 0) {
    const actualFirstIdx = headingIdx + 1 + matchingIndices[0]
    lines[actualFirstIdx] = canonicalEntry
    for (let k = matchingIndices.length - 1; k >= 1; k--) {
      lines.splice(headingIdx + 1 + matchingIndices[k], 1)
    }
    return lines.join(eol)
  }
  const placeholderIdx = sectionLines.findIndex((line) =>
    /No\s+topic\s+memories\s+yet/i.test(line.trim()),
  )
  if (placeholderIdx !== -1) {
    lines[headingIdx + 1 + placeholderIdx] = canonicalEntry
    return lines.join(eol)
  }
  let lastEntryOffset = -1
  for (let i = sectionLines.length - 1; i >= 0; i--) {
    if (/^\s*-\s*`/.test(sectionLines[i])) {
      lastEntryOffset = i
      break
    }
  }
  if (lastEntryOffset !== -1) {
    lines.splice(headingIdx + 1 + lastEntryOffset + 1, 0, canonicalEntry)
    return lines.join(eol)
  }
  let insertIdx = headingIdx + 1
  while (insertIdx < nextSectionIdx && lines[insertIdx].trim() === '') insertIdx++
  lines.splice(insertIdx, 0, canonicalEntry)
  return lines.join(eol)
}

async function applyMemoryMapEntry(projectRoot: string, topic: string): Promise<void> {
  if (!isAbsolute(projectRoot)) throw new Error(`projectRoot must be an absolute path, received "${projectRoot}"`)
  if (!isValidTopicIdentifier(topic)) throw new Error(`Invalid topic memory identifier "${topic}"`)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  await ensureCanonicalDirectory(dshDir)
  await ensureCanonicalDirectory(memoryDir)
  let exists = false
  try {
    const stats = await lstat(memoryMd)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Project memory at "${memoryMd}" must be a regular file, not a symbolic link or non-regular entry`,
      )
    }
    exists = true
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }
  if (!exists) await ensureProjectMemoryBootstrap(projectRoot)
  const currentContent = await readFile(memoryMd, 'utf8')
  const updatedContent = insertTopicIntoMemoryMapContent(currentContent, topic)
  if (updatedContent === currentContent) return
  assertBootstrapBounds(updatedContent)
  await writeSafeFileAtomically(memoryDir, memoryMd, Buffer.from(updatedContent, 'utf8'))
}

export async function ensureMemoryMapEntry(projectRoot: string, topic: string): Promise<void> {
  if (topic === 'memory') return
  const normRoot = normalize(projectRoot)
  const prevLock = mapMutexes.get(normRoot) ?? Promise.resolve()
  let releaseLock: () => void = () => {}
  const nextLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  mapMutexes.set(normRoot, nextLock)
  try {
    await prevLock
    await applyMemoryMapEntry(normRoot, topic)
  } finally {
    releaseLock()
    if (mapMutexes.get(normRoot) === nextLock) mapMutexes.delete(normRoot)
  }
}
