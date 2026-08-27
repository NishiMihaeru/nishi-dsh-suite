/**
 * Vendor CLIs commonly write their explanation to stderr AFTER emitting the
 * terminal protocol frame, so reading stderr the instant that frame arrives
 * sees an empty buffer. `settledStderr` waits a bounded amount for the
 * process to settle before reading the collected stderr tail.
 *
 * @module nishi-dsh-core/runtime/stderr
 */

import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

function assertGraceMs(graceMs: number): void {
  if (!Number.isFinite(graceMs) || !Number.isSafeInteger(graceMs) || graceMs <= 0) {
    throw new Error('provider-kit: graceMs must be a positive safe integer')
  }
  if (graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`provider-kit: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

function collectedStderrText(handle: SubprocessHandle): string | undefined {
  try {
    return handle.collected.stderr?.readFrom(0).text
  } catch {
    return undefined
  }
}

/**
 * Wait up to `graceMs` for `handle.done` to settle, then read whatever
 * stderr text has been collected so far (possibly none). Never rejects on
 * timeout — an unsettled process after the grace period simply means stderr
 * is read at whatever point it has reached.
 */
export async function settledStderr(
  handle: SubprocessHandle,
  graceMs: number,
): Promise<string | undefined> {
  assertGraceMs(graceMs)

  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      handle.done.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolveWait) => {
        timer = setTimeout(resolveWait, graceMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  return collectedStderrText(handle)
}
