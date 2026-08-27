import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertNoForbiddenVendorRuntimes,
  forbiddenVendorRuntime,
} from './vendor-runtime-contract.mjs'

test('forbidden vendor runtime predicate covers exact packages and platform families', () => {
  for (const name of [
    '@openai/codex',
    '@openai/codex-sdk',
    '@openai/codex-linux-x64',
    '@openai/codex-win32-x64',
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  ]) {
    assert.equal(forbiddenVendorRuntime(name), true, name)
  }

  for (const name of [
    '@openai/openai',
    '@anthropic-ai/sdk',
    '@deepseek-ai/dsh-subprocess',
    'nishi-dsh-codex',
  ]) {
    assert.equal(forbiddenVendorRuntime(name), false, name)
  }
})

test('negative manifest fixture names the forbidden runtime and dependency section', () => {
  assert.throws(
    () => assertNoForbiddenVendorRuntimes('fixture-package', {
      dependencies: {
        '@openai/codex': '0.150.0',
      },
    }),
    (error) => {
      assert.match(String(error?.message), /fixture-package/)
      assert.match(String(error?.message), /dependencies/)
      assert.match(String(error?.message), /@openai\/codex/)
      return true
    },
  )
})

test('optional dependency regressions are rejected too', () => {
  assert.throws(
    () => assertNoForbiddenVendorRuntimes('fixture-package', {
      optionalDependencies: {
        '@anthropic-ai/claude-agent-sdk-win32-x64': '0.3.220',
      },
    }),
    /@anthropic-ai\/claude-agent-sdk-win32-x64/,
  )
})
