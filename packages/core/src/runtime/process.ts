/**
 * Vendor CLI process helpers owned by DSH subprocess: bounded
 * newline-delimited stream decoding and child disposal.
 *
 * @module nishi-dsh-core/runtime/process
 */

import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
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
 *
 * Buffer chunks are decoded with a streaming UTF-8 decoder so a multi-byte
 * code point split across two chunks is reconstructed before line parsing.
 */
export async function* outputLines(
  stdout: Readable,
  maxBytes: number,
): AsyncGenerator<string, void, void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('nishi-core: maxBytes must be a positive safe integer')
  }

  let buffered = ''
  let decoder = new StringDecoder('utf8')

  const appendDecodedChunk = (chunk: unknown): void => {
    if (typeof chunk === 'string') {
      // A string chunk has already been decoded upstream. Flush any pending
      // byte sequence from a preceding Buffer before appending it, then reset
      // the decoder for any later Buffer chunks.
      buffered += decoder.end()
      decoder = new StringDecoder('utf8')
      buffered += chunk
      return
    }

    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Buffer.from(String(chunk), 'utf8')
    buffered += decoder.write(bytes)
  }

  const drainCompleteLines = function* (): Generator<string, void, void> {
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) return

      let line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (Buffer.byteLength(line, 'utf8') > maxBytes) throw lineTooLarge(maxBytes)
      yield line
    }
  }

  for await (const chunk of stdout) {
    appendDecodedChunk(chunk)
    yield* drainCompleteLines()

    // StringDecoder may retain at most a partial UTF-8 code point internally;
    // the decoded remainder is still bounded here, with only that tiny decoder
    // state held outside `buffered` until the next chunk arrives.
    if (Buffer.byteLength(buffered, 'utf8') > maxBytes) throw lineTooLarge(maxBytes)
  }

  buffered += decoder.end()
  yield* drainCompleteLines()

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
