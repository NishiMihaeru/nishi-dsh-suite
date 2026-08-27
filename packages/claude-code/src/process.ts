/** Direct Claude Code CLI process helpers owned by DSH subprocess. */

import type { Readable } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

export const MAX_CLAUDE_STREAM_LINE_BYTES = 1024 * 1024

function lineTooLarge(): Error {
  return new Error(
    `subagent-claude-code: Claude stream line exceeded maximum ${MAX_CLAUDE_STREAM_LINE_BYTES} bytes`,
  )
}

/** Decode bounded newline-delimited UTF-8 records from Claude stdout. */
export async function* claudeOutputLines(
  stdout: Readable,
): AsyncGenerator<string, void, void> {
  let buffered = ''

  for await (const chunk of stdout) {
    buffered += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)

    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break

      let line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (Buffer.byteLength(line, 'utf8') > MAX_CLAUDE_STREAM_LINE_BYTES) throw lineTooLarge()
      yield line
    }

    if (Buffer.byteLength(buffered, 'utf8') > MAX_CLAUDE_STREAM_LINE_BYTES) throw lineTooLarge()
  }

  if (buffered.length > 0) {
    if (buffered.endsWith('\r')) buffered = buffered.slice(0, -1)
    if (Buffer.byteLength(buffered, 'utf8') > MAX_CLAUDE_STREAM_LINE_BYTES) throw lineTooLarge()
    yield buffered
  }
}

/** Terminate the whole managed Claude process tree and prove quiescence. */
export async function disposeClaudeCliChild(
  child: SubprocessHandle,
): Promise<SubprocessOutcome> {
  child.terminate()
  await child.waitForExit()
  return await child.done
}
