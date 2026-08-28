import { dirname, isAbsolute, join, normalize } from 'node:path'
import { MAX_BOOTSTRAP_BYTES, MAX_BOOTSTRAP_LINES } from './bootstrap.js'
import { readSafeRegularFile } from './filesystem.js'
import { resolveProjectMemoryPaths } from './paths.js'
import { withExistingProjectMemoryScope } from './storage.js'
import { recoverPendingProjectMemoryTransaction } from './transaction.js'

export const MAX_ALWAYS_CONTEXT_INSTRUCTION_BYTES = 64 * 1024 // 64 KiB (65,536 bytes)

export interface CanonicalContextSource {
  readonly exists: boolean
  readonly content: string | null
}

export interface CanonicalProjectContext {
  readonly globalInstructions: CanonicalContextSource
  readonly projectContract: CanonicalContextSource
  readonly memoryBootstrap: CanonicalContextSource
}

export interface DshProjectContext {
  readonly projectContract: CanonicalContextSource
  readonly memoryBootstrap: CanonicalContextSource
}

export interface ReadCanonicalProjectContextOptions {
  readonly projectRoot: string
  readonly dshHome: string
  readonly signal?: AbortSignal
}

export interface ReadDshProjectContextOptions {
  readonly projectRoot: string
  readonly signal?: AbortSignal
}

interface ReadInstructionResult {
  readonly exists: boolean
  readonly content: string | null
  readonly rawLength: number
}

function countLines(content: string): number {
  if (content.length === 0) return 0
  let count = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') count++
  }
  if (!content.endsWith('\n')) count++
  return count
}

async function readInstructionFile(
  filePath: string,
  sourceLabel: 'global instructions' | 'project contract',
  signal?: AbortSignal,
): Promise<ReadInstructionResult> {
  signal?.throwIfAborted()
  const parent = dirname(filePath)

  try {
    const buffer = await readSafeRegularFile(parent, filePath, {
      signal,
      maxBytes: MAX_ALWAYS_CONTEXT_INSTRUCTION_BYTES,
      allowDirectorySymlink: true,
    })
    if (buffer === null) return { exists: false, content: null, rawLength: 0 }
    signal?.throwIfAborted()
    return {
      exists: true,
      content: buffer.toString('utf8'),
      rawLength: buffer.length,
    }
  } catch (err: any) {
    if (signal?.aborted) signal.throwIfAborted()
    if (typeof err?.message === 'string' && err.message.includes('exceeds maximum size limit')) {
      throw new Error('Canonical context instruction budget exceeded.')
    }
    throw new Error(`Canonical context ${sourceLabel} could not be read safely.`)
  }
}

async function readStrictMemoryBootstrap(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<CanonicalContextSource> {
  signal?.throwIfAborted()
  const paths = resolveProjectMemoryPaths(projectRoot)

  try {
    const result = await withExistingProjectMemoryScope(projectRoot, async (memoryScope) => {
      const rawBuffer = await memoryScope.readRegularFile(paths.memoryMd, {
        maxBytes: MAX_BOOTSTRAP_BYTES,
      })
      if (rawBuffer === null) return { exists: false, content: null }
      signal?.throwIfAborted()

      const content = rawBuffer.toString('utf8')
      if (countLines(content) > MAX_BOOTSTRAP_LINES) {
        throw new Error('Canonical context memory bootstrap could not be read safely.')
      }
      return { exists: true, content }
    }, signal)
    return result ?? { exists: false, content: null }
  } catch (err: any) {
    if (signal?.aborted) signal.throwIfAborted()
    throw new Error('Canonical context memory bootstrap could not be read safely.')
  }
}

export async function readCanonicalProjectContext(
  options: ReadCanonicalProjectContextOptions,
): Promise<CanonicalProjectContext> {
  options?.signal?.throwIfAborted()

  if (!options || typeof options !== 'object') {
    throw new TypeError('Canonical context options must be an object.')
  }
  if (typeof options.projectRoot !== 'string' || options.projectRoot.trim() === '') {
    throw new TypeError('Canonical context requires a valid non-empty projectRoot string.')
  }
  if (typeof options.dshHome !== 'string' || options.dshHome.trim() === '') {
    throw new TypeError('Canonical context requires a valid non-empty dshHome string.')
  }
  if (!isAbsolute(options.projectRoot)) {
    throw new TypeError('Canonical context requires an absolute projectRoot path.')
  }
  if (!isAbsolute(options.dshHome)) {
    throw new TypeError('Canonical context requires an absolute dshHome path.')
  }

  const signal = options.signal
  signal?.throwIfAborted()

  const projectRoot = normalize(options.projectRoot)
  const dshHome = normalize(options.dshHome)
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  signal?.throwIfAborted()

  const agentsPath = join(dshHome, 'AGENTS.md')
  const dshPath = join(projectRoot, 'DSH.md')
  const agentsResult = await readInstructionFile(agentsPath, 'global instructions', signal)
  const dshResult = await readInstructionFile(dshPath, 'project contract', signal)

  const totalInstructionBytes = agentsResult.rawLength + dshResult.rawLength
  if (totalInstructionBytes > MAX_ALWAYS_CONTEXT_INSTRUCTION_BYTES) {
    throw new Error('Canonical context instruction budget exceeded.')
  }

  signal?.throwIfAborted()
  const memoryBootstrap = await readStrictMemoryBootstrap(projectRoot, signal)
  signal?.throwIfAborted()

  return {
    globalInstructions: {
      exists: agentsResult.exists,
      content: agentsResult.content,
    },
    projectContract: {
      exists: dshResult.exists,
      content: dshResult.content,
    },
    memoryBootstrap,
  }
}

export async function readDshProjectContext(
  options: ReadDshProjectContextOptions,
): Promise<DshProjectContext> {
  options?.signal?.throwIfAborted()

  if (!options || typeof options !== 'object') {
    throw new TypeError('DSH project context options must be an object.')
  }
  if (typeof options.projectRoot !== 'string' || options.projectRoot.trim() === '') {
    throw new TypeError('DSH project context requires a valid non-empty projectRoot string.')
  }
  if (!isAbsolute(options.projectRoot)) {
    throw new TypeError('DSH project context requires an absolute projectRoot path.')
  }

  const signal = options.signal
  signal?.throwIfAborted()

  const projectRoot = normalize(options.projectRoot)
  await recoverPendingProjectMemoryTransaction(projectRoot, signal)
  signal?.throwIfAborted()

  const dshPath = join(projectRoot, 'DSH.md')
  const dshResult = await readInstructionFile(dshPath, 'project contract', signal)

  signal?.throwIfAborted()
  const memoryBootstrap = await readStrictMemoryBootstrap(projectRoot, signal)
  signal?.throwIfAborted()

  return {
    projectContract: {
      exists: dshResult.exists,
      content: dshResult.content,
    },
    memoryBootstrap,
  }
}
