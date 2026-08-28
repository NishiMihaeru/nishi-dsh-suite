import { isAbsolute, join } from 'node:path'
import {
  ensureCanonicalDirectory,
  readSafeRegularFile,
  validateCanonicalDirectory,
  withSafeFileWriterLock,
  type SafeDirectoryScope,
} from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { isValidTopicIdentifier } from './topic-id.js'
import {
  recoverPendingProjectMemoryTransaction,
  settleCommittedProjectMemoryTransactionUnderMapLock,
} from './transaction.js'

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

export type CommitMemoryMapEntry = () => Promise<void>

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

async function ensureBootstrapFile(
  scope: SafeDirectoryScope,
  memoryMd: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const existing = await scope.readRegularFile(memoryMd)
  if (existing !== null) return false
  return scope.writeFileExclusiveAtomic(
    memoryMd,
    INITIAL_MEMORY_MD_CONTENT,
    { mode: 0o644 },
  )
}

async function readBootstrapOrInitial(
  scope: SafeDirectoryScope,
  memoryMd: string,
): Promise<string> {
  const existing = await scope.readRegularFile(memoryMd)
  return existing === null ? INITIAL_MEMORY_MD_CONTENT : existing.toString('utf8')
}

export async function ensureProjectMemoryBootstrap(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<EnsureProjectMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })
  await ensureCanonicalDirectory(memoryDir, signal)
  const created = await withSafeFileWriterLock(
    memoryDir,
    memoryMd,
    (scope) => ensureBootstrapFile(scope, memoryMd, signal),
    signal,
  )
  return { created, memoryPath: memoryMd }
}

export async function readProjectMemoryBootstrap(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<ReadProjectMemoryResult> {
  signal?.throwIfAborted()
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  if (!(await validateCanonicalDirectory(dshDir, signal))) return { exists: false, content: null, path: memoryMd }
  if (!(await validateCanonicalDirectory(memoryDir, signal))) return { exists: false, content: null, path: memoryMd }
  const rawBuffer = await readSafeRegularFile(memoryDir, memoryMd, { signal })
  if (rawBuffer === null) return { exists: false, content: null, path: memoryMd }
  return {
    exists: true,
    content: boundedUtf8Bootstrap(rawBuffer, MAX_BOOTSTRAP_LINES, MAX_BOOTSTRAP_BYTES),
    path: memoryMd,
  }
}

export async function writeProjectMemoryBootstrap(
  projectRoot: string,
  content: string,
  signal?: AbortSignal,
): Promise<WriteProjectMemoryBootstrapResult> {
  signal?.throwIfAborted()
  if (!isAbsolute(projectRoot)) throw new Error(`projectRoot must be an absolute path, received "${projectRoot}"`)
  if (typeof content !== 'string') throw new Error('Project memory bootstrap content must be a string')
  assertBootstrapBounds(content)
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })
  await ensureCanonicalDirectory(memoryDir, signal)

  return withSafeFileWriterLock(memoryDir, memoryMd, async (scope) => {
    signal?.throwIfAborted()
    const current = await scope.readRegularFile(memoryMd)
    const created = current === null
    signal?.throwIfAborted()
    await scope.writeFileAtomically(memoryMd, Buffer.from(content, 'utf8'))
    return { created, memoryPath: memoryMd }
  }, signal)
}

export async function editProjectMemoryBootstrap(
  projectRoot: string,
  oldText: string,
  newText: string,
  signal?: AbortSignal,
): Promise<EditProjectMemoryBootstrapResult> {
  signal?.throwIfAborted()
  if (!isAbsolute(projectRoot)) throw new Error(`projectRoot must be an absolute path, received "${projectRoot}"`)
  if (typeof oldText !== 'string' || oldText.length === 0) throw new Error('oldText must be a non-empty string')
  if (typeof newText !== 'string') throw new Error('newText must be a string')
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  if (!(await validateCanonicalDirectory(dshDir, signal))) {
    throw new Error(`Cannot edit project memory bootstrap: directory "${dshDir}" does not exist`)
  }
  if (!(await validateCanonicalDirectory(memoryDir, signal))) {
    throw new Error(`Cannot edit project memory bootstrap: directory "${memoryDir}" does not exist`)
  }

  return withSafeFileWriterLock(memoryDir, memoryMd, async (scope) => {
    signal?.throwIfAborted()
    const currentBuffer = await scope.readRegularFile(memoryMd)
    if (currentBuffer === null) {
      throw new Error(`Project memory bootstrap file "${memoryMd}" does not exist; cannot edit missing file`)
    }
    const currentContent = currentBuffer.toString('utf8')
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
    signal?.throwIfAborted()
    await scope.writeFileAtomically(memoryMd, updatedBuffer)
    return { memoryPath: memoryMd, bytesWritten: updatedBuffer.length }
  }, signal)
}

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

/**
 * Hold the MEMORY.md writer lock while preflighting one canonical map entry.
 * The callback receives the same directory scope that owns MEMORY.md.lock so a
 * nested topic lock/read/write cannot reopen a replaceable parent pathname.
 */
export async function withMemoryMapEntryTransaction<T>(
  projectRoot: string,
  topic: string,
  operation: (commitMap: CommitMemoryMapEntry, memoryScope: SafeDirectoryScope) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  if (!isAbsolute(projectRoot)) throw new Error(`projectRoot must be an absolute path, received "${projectRoot}"`)
  if (!isValidTopicIdentifier(topic)) throw new Error(`Invalid topic memory identifier "${topic}"`)
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  const paths = resolveProjectMemoryPaths(projectRoot)
  const dshDir = join(paths.projectRoot, '.dsh')
  const memoryDir = paths.memoryDir
  const memoryMd = paths.memoryMd
  await ensureCanonicalDirectory(dshDir, signal, { allowParentDirectorySymlink: true })
  await ensureCanonicalDirectory(memoryDir, signal)

  return withSafeFileWriterLock(memoryDir, memoryMd, async (scope) => {
    signal?.throwIfAborted()
    await settleCommittedProjectMemoryTransactionUnderMapLock(projectRoot, scope, signal)
    const currentContent = await readBootstrapOrInitial(scope, memoryMd)
    const updatedContent = insertTopicIntoMemoryMapContent(currentContent, topic)
    assertBootstrapBounds(updatedContent)
    let committed = false
    const commitMap: CommitMemoryMapEntry = async () => {
      if (committed) return
      signal?.throwIfAborted()
      if (updatedContent !== currentContent || currentContent === INITIAL_MEMORY_MD_CONTENT) {
        await scope.writeFileAtomically(memoryMd, Buffer.from(updatedContent, 'utf8'))
      }
      committed = true
    }

    const result = await operation(commitMap, scope)
    if (!committed) {
      throw new Error(`Project memory transaction for topic "${topic}" completed without committing the Memory map`)
    }
    return result
  }, signal)
}

export async function ensureMemoryMapEntry(
  projectRoot: string,
  topic: string,
  signal?: AbortSignal,
): Promise<void> {
  if (topic === 'memory') return
  await withMemoryMapEntryTransaction(projectRoot, topic, async (commitMap) => {
    await commitMap()
  }, signal)
}
