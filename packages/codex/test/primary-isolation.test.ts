import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexAppServerAdapter } from '../src/codex-plugin-dsh/adapter.ts'

const config = {
  executable: 'codex',
  env: {},
  modelCacheMs: 30_000,
  catalogTimeoutMs: 10_000,
  turnTimeoutMs: 600_000,
  disposeGraceMs: 3_000,
  stderrMaxBytes: 16_384,
  modelPageSize: 100,
}

test('primary App Server isolation uses current feature gates and disables user-enabled host tool surfaces', async () => {
  const requests: Array<{ method: string; params: object; signal: AbortSignal }> = []
  const signal = AbortSignal.timeout(5_000)
  const connection = {
    async request(method: string, params: object, receivedSignal: AbortSignal) {
      requests.push({ method, params, signal: receivedSignal })
      return {
        config: {
          features: {
            hooks: true,
            multi_agent_v2: true,
            code_mode: true,
            view_image: true,
            apps: true,
            plugins: true,
          },
          apps: {
            _default: { enabled: true },
            calendar: { enabled: true },
          },
          mcp_servers: {
            local: { command: 'ignored-by-test' },
          },
        },
      }
    },
  }

  const adapter = new CodexAppServerAdapter({} as any, config)
  const isolation = await (adapter as any).isolationConfig(connection, signal)

  assert.deepEqual(requests, [{
    method: 'config/read',
    params: { includeLayers: false },
    signal,
  }])
  assert.deepEqual(isolation, {
    features: {
      shell_tool: false,
      unified_exec: false,
      multi_agent: false,
      multi_agent_v2: false,
      code_mode: false,
      view_image: false,
      hooks: false,
      apps: false,
      plugins: false,
    },
    agents: { enabled: false },
    web_search: 'disabled',
    apps: {
      _default: { enabled: false },
      calendar: { enabled: false },
    },
    mcp_servers: {
      local: { enabled: false },
    },
  })
  assert.equal(Object.hasOwn(isolation, 'tools'), false, 'tools.view_image is not valid in current Codex ConfigToml')
})
