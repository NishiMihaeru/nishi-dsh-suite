import assert from 'node:assert/strict'
import test from 'node:test'
import { HostAntigravityLocalUsageSource } from '../src/usage-source.ts'

/**
 * How a discovered endpoint becomes a URL.
 *
 * The host type here is literally `'127.0.0.1' | '::1'`, and an IPv6 literal
 * needs brackets in an authority: `new URL('https://::1:42100/x')` throws
 * `Invalid URL`. Every IPv6 loopback candidate was therefore discovered
 * correctly and then silently discarded, with usage reporting unavailable while
 * a live endpoint was listening. The failure is silent by construction, which is
 * why it needs a test rather than a reading.
 */

function sourceWithEndpoint(host: '127.0.0.1' | '::1', urls: string[]) {
  return new HostAntigravityLocalUsageSource({
    platformDiscovery: {
      async discoverCandidates() {
        return [{ pid: 4242, sourceKind: 'AGY' as const, ports: [], csrfToken: 'token' }]
      },
      async discoverListeners() {
        return [{ host, port: 42100 }]
      },
    },
    async requestTransport(url: string) {
      urls.push(url)
      // Refusing keeps the probe short: the URL is the subject, not the reply.
      return { status: 503, bodyText: '' }
    },
  } as any)
}

test('an IPv6 loopback endpoint is bracketed, so its URL parses at all', async () => {
  const urls: string[] = []
  await sourceWithEndpoint('::1', urls).read().catch(() => { /* outcome is not the subject */ })
  assert.ok(urls.length > 0, 'no request was attempted for an IPv6 endpoint')
  for (const url of urls) {
    assert.ok(url.includes('[::1]:42100'), `unbracketed IPv6 authority: ${url}`)
    assert.doesNotThrow(() => new URL(url), `the probe built a URL that cannot be parsed: ${url}`)
  }
})

test('an IPv4 loopback endpoint is left exactly as it was', async () => {
  const urls: string[] = []
  await sourceWithEndpoint('127.0.0.1', urls).read().catch(() => {})
  assert.ok(urls.length > 0)
  for (const url of urls) {
    assert.ok(url.includes('127.0.0.1:42100'), `unexpected IPv4 authority: ${url}`)
    assert.ok(!url.includes('['), `IPv4 must not be bracketed: ${url}`)
  }
})
