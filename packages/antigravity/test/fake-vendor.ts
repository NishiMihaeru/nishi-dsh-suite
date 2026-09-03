import { PassThrough } from 'node:stream'

/**
 * The one extra vendor spawn every fake `agy` in this suite has to answer.
 *
 * The adapter reads `agy --version` once, fire-and-forget, so a failed turn
 * can name the build it ran against -- `agy` self-updates, so that fact is
 * gone by the time anyone reads the report. Nothing awaits the read and no
 * turn fails because it failed, but it IS a real spawn on the turn path, so a
 * harness that does not answer it either hands the version read a turn child
 * or counts it as a turn spawn. Both were observed: 29 tests failed on the
 * spawn count alone when this was introduced.
 *
 * Shared rather than copied into each harness because there are ten of them,
 * and a stub that quietly disagrees with the others is how a suite starts
 * measuring itself instead of the product.
 *
 * @module nishi-dsh-antigravity/test/fake-vendor
 */

/** Deliberately not a real `agy` version, so a test asserting on it cannot pass by accident. */
export const FAKE_VENDOR_BUILD = '9.9.9'

/** Whether this spawn is the version read rather than a turn or a catalog load. */
export function isVersionSpawn(argv: readonly string[]): boolean {
  return argv.includes('--version')
}

/**
 * A collected child answering `--version` the way the real CLI does: the bare
 * version on stdout, exit 0.
 *
 * @param stdout - Replaces the whole output, for the unparseable-output cases.
 * @param exitCode - Replaces the exit code, for the read-failed cases.
 */
export function versionChild(stdout = `${FAKE_VENDOR_BUILD}\n`, exitCode: number | null = 0) {
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  queueMicrotask(() => done.resolve({ exitCode, signal: null }))
  return {
    pid: 5100,
    stdin: undefined,
    stdout: new PassThrough(),
    stderr: undefined,
    collected: {
      stdout: { readFrom() { return { text: stdout, nextOffset: stdout.length, lossy: false } } },
      stderr: { readFrom() { return { text: '', nextOffset: 0, lossy: false } } },
    },
    done: done.promise,
    terminate() {},
    async waitForExit() { await done.promise; return true },
  }
}
