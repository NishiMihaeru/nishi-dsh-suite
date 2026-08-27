/**
 * Vendor CLI process helpers owned by DSH subprocess: bounded
 * newline-delimited stream decoding and child disposal.
 *
 * @module nishi-dsh-core/runtime/process
 */

import type { Readable } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

function lineTooLarge(maxBytes: number): Error {
  return new Error(`nishi-core: stream line exceeded maximum ${maxBytes} bytes`)
}

/**
 * Decode bounded newline-delimited UTF-8 records from a vendor CLI's stdout.
 *
 * Tolerant of CRLF line endings. A line (or the final unterminated
 * remainder) larger than `maxBytes` fails the generator rather than
 * buffering without limit. The trailing partial line, if any, is yielded
 * once the stream ends even without a terminating newline.
 */
export async function* outputLines(
  stdout: Readable,
  maxBytes: number,
): AsyncGenerator<string, void, void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('nishi-core: maxBytes must be a positive safe integer')
  }

  let buffered = ''

  for await (const chunk of stdout) {
    buffered += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)

    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break

      let line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (Buffer.byteLength(line, 'utf8') > maxBytes) throw lineTooLarge(maxBytes)
      yield line
    }

    if (Buffer.byteLength(buffered, 'utf8') > maxBytes) throw lineTooLarge(maxBytes)
  }

  if (buffered.length > 0) {
    if (buffered.endsWith('\r')) buffered = buffered.slice(0, -1)
    if (Buffer.byteLength(buffered, 'utf8') > maxBytes) throw lineTooLarge(maxBytes)
    yield buffered
  }
}

/**
 * Terminate a managed vendor process tree and prove quiescence.
 *
 * A spawn that never produced a live process (`pid <= 0`) is disposed by
 * simply awaiting settlement, swallowing any rejection — there is nothing
 * left to terminate. Otherwise stdin is closed best-effort (a still-open
 * pipe can keep some vendor CLIs from noticing termination), then the tree
 * is terminated, its exit awaited, and its outcome awaited.
 */
export async function disposeVendorChild(
  child: SubprocessHandle,
): Promise<SubprocessOutcome | undefined> {
  if (child.pid <= 0) {
    return await child.done.catch(() => undefined)
  }
  try {
    child.stdin?.end()
  } catch {
    // best-effort; disposal still proceeds via terminate/waitForExit/done.
  }
  child.terminate()
  await child.waitForExit()
  return await child.done
}
