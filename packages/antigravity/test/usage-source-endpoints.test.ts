import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravityQuotaHarvestCache } from '../src/quota-harvest-cache.ts'

/**
 * How a discovered listener becomes a URL.
 *
 * The host type here is literally `'127.0.0.1' | '::1'`, and an IPv6 literal
 * needs brackets in an authority: `new URL('https://::1:42100/x')` throws
 * `Invalid URL`. Every IPv6 loopback listener was therefore discovered
 * correctly and then silently discarded, with usage reporting unavailable while
 * a live endpoint was listening. The failure is silent by construction, which is
 * why it needs a test rather than a reading.
 *
 * The subject moved on 2026-09-03 without the regression moving with it: this
 * used to test the machine-wide `HostAntigravityLocalUsageSource`, which was
 * removed for scanning other processes, and the same bracketing now happens on
 * the own-child harvest path in `quota-harvest-cache.ts`.
 */

function harvestWithListener(host: '127.0.0.1' | '::1', urls: string[]) {
  return new AntigravityQuotaHarvestCache({
    async discoverListeners() {
      return [{ host, port: 42100 }]
    },
    async requestTransport(url: string) {
      urls.push(url)
      // Refusing keeps the probe short: the URL is the subject, not the reply.
      return { status: 503, body: '' }
    },
    maxAttempts: 1,
  })
}

test('an IPv6 loopback listener is bracketed, so its URL parses at all', async () => {
  const urls: string[] = []
  await harvestWithListener('::1', urls).harvest(4242)
  assert.ok(urls.length > 0, 'no request was attempted for an IPv6 listener')
  for (const url of urls) {
    assert.ok(url.includes('[::1]:42100'), `unbracketed IPv6 authority: ${url}`)
    assert.doesNotThrow(() => new URL(url), `the probe built a URL that cannot be parsed: ${url}`)
  }
})

test('an IPv4 loopback listener is left exactly as it was', async () => {
  const urls: string[] = []
  await harvestWithListener('127.0.0.1', urls).harvest(4242)
  assert.ok(urls.length > 0)
  for (const url of urls) {
    assert.ok(url.includes('127.0.0.1:42100'), `unexpected IPv4 authority: ${url}`)
    assert.ok(!url.includes('['), `IPv4 must not be bracketed: ${url}`)
  }
})
