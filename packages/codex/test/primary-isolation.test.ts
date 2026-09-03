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

test('primary App Server isolation reads the session project layers and disables every discovered host capability', async () => {
  const requests: Array<{ method: string; params: object; signal: AbortSignal }> = []
  const signal = AbortSignal.timeout(5_000)
  const connection = {
    async request(method: string, params: object, receivedSignal: AbortSignal) {
      requests.push({ method, params, signal: receivedSignal })
      if (method === 'skills/list') {
        return {
          data: [{
            cwd: '/workspace',
            skills: [
              { name: 'alpha', path: '/home/test/.agents/skills/alpha/SKILL.md', enabled: true, pluginId: null },
              { name: 'beta', path: '/workspace/.agents/skills/beta/SKILL.md', enabled: false, pluginId: null },
              { name: 'alpha-copy', path: '/home/test/.agents/skills/alpha/SKILL.md', enabled: true, pluginId: null },
            ],
            errors: [],
          }],
        }
      }
      assert.equal(method, 'config/read')
      return {
        config: {
          features: {
            shell_snapshot: true,
            code_mode_host: true,
            memories: true,
            hooks: true,
            goals: true,
            token_budget: true,
            multi_agent_v2: true,
            code_mode: true,
            view_image: true,
            apps: true,
            plugins: true,
          },
          notify: ['dangerous-host-command'],
          model_instructions_file: '/tmp/vendor-instructions.md',
          apps: {
            _default: { enabled: true },
            calendar: { enabled: true },
            projectOnly: { enabled: true },
          },
          mcp_servers: {
            local: { command: 'ignored-by-test' },
            projectOnly: { command: 'project-only-command' },
          },
        },
      }
    },
  }

  const adapter = new CodexAppServerAdapter({} as any, config)
  const isolation = await (adapter as any).isolationConfig(connection, '/workspace', signal)

  assert.deepEqual(requests, [
    {
      method: 'config/read',
      params: { includeLayers: false, cwd: '/workspace' },
      signal,
    },
    {
      method: 'skills/list',
      params: { cwds: ['/workspace'], forceReload: true },
      signal,
    },
  ])
  assert.deepEqual(isolation, {
    features: {
      shell_tool: false,
      unified_exec: false,
      shell_zsh_fork: false,
      shell_snapshot: false,
      shell_snapshot_v2: false,
      exec_permission_approvals: false,
      request_permissions_tool: false,
      multi_agent: false,
      multi_agent_v2: false,
      code_mode: false,
      memories: false,
      external_agent_memory_import: false,
      chronicle: false,
      view_image: false,
      hooks: false,
      goals: false,
      token_budget: false,
      rollout_budget: false,
      current_time_reminder: false,
      skill_search: false,
      skill_mcp_dependency_install: false,
      deferred_executor: false,
      executor_capability_discovery: false,
      apps: false,
      enable_mcp_apps: false,
      plugins: false,
      recommended_plugins: false,
      tool_suggest: false,
      remote_plugin: false,
      plugin_sharing: false,
      browser_use: false,
      browser_use_full_cdp_access: false,
      browser_use_external: false,
      computer_use: false,
      in_app_browser: false,
      in_app_chat: false,
      in_app_dictation: false,
      in_app_local_automation: false,
      in_app_updates: false,
      network_proxy: false,
      unbounded_connection_retries: false,
      guardian_approval: false,
      guardianv2: false,
      guardian_ext: false,
      tool_call_mcp_elicitation: false,
      auth_elicitation: false,
      artifact: false,
      workspace_dependencies: false,
      prevent_idle_sleep: false,
    },
    agents: { enabled: false },
    tools: {
      experimental_request_user_input: { enabled: false },
      update_plan: { enabled: false },
    },
    web_search: 'disabled',
    notify: [],
    include_permissions_instructions: false,
    include_apps_instructions: false,
    include_collaboration_mode_instructions: false,
    include_environment_context: false,
    allow_login_shell: false,
    orchestrator: {
      skills: { enabled: false },
      mcp: { enabled: false },
    },
    skills: {
      bundled: { enabled: false },
      include_instructions: false,
      config: [
        { path: '/home/test/.agents/skills/alpha/SKILL.md', enabled: false },
        { path: '/workspace/.agents/skills/beta/SKILL.md', enabled: false },
      ],
    },
    apps: {
      _default: { enabled: false },
      calendar: { enabled: false },
      projectOnly: { enabled: false },
    },
    mcp_servers: {
      local: { enabled: false },
      projectOnly: { enabled: false },
    },
  })
  assert.equal(Object.hasOwn((isolation as any).features, 'image_generation'), false, 'native image generation is the one intentional Codex host capability')
})

test('primary thread parameters always own base instructions and do not fall back to vendor config', () => {
  const adapter = new CodexAppServerAdapter({} as any, config)
  const withoutSystem = (adapter as any).threadParams(
    { model: 'gpt-5.6-sol' },
    '/workspace',
    {},
    [],
  )
  const withSystem = (adapter as any).threadParams(
    { model: 'gpt-5.6-sol', system: 'DSH system instructions' },
    '/workspace',
    {},
    [],
  )

  assert.equal(withoutSystem.baseInstructions, '')
  assert.equal(withSystem.baseInstructions, 'DSH system instructions')
})

test('primary App Server isolation fails closed when config/read omits config', async () => {
  const signal = AbortSignal.timeout(5_000)
  const connection = {
    async request(method: string) {
      if (method === 'config/read') return {}
      throw new Error(`unexpected method ${method}`)
    },
  }

  const adapter = new CodexAppServerAdapter({} as any, config)
  await assert.rejects(
    (adapter as any).isolationConfig(connection, '/workspace', signal),
    /invalid config\/read config/,
  )
})

test('primary App Server isolation fails closed when mcp_servers is not an object', async () => {
  const signal = AbortSignal.timeout(5_000)
  const connection = {
    async request(method: string) {
      if (method === 'config/read') return { config: { mcp_servers: ['local'] } }
      throw new Error(`unexpected method ${method}`)
    },
  }

  const adapter = new CodexAppServerAdapter({} as any, config)
  await assert.rejects(
    (adapter as any).isolationConfig(connection, '/workspace', signal),
    /invalid config\/read mcp_servers/,
  )
})

test('primary App Server isolation fails closed when apps is not an object', async () => {
  const signal = AbortSignal.timeout(5_000)
  const connection = {
    async request(method: string) {
      if (method === 'config/read') return { config: { apps: 'calendar' } }
      throw new Error(`unexpected method ${method}`)
    },
  }

  const adapter = new CodexAppServerAdapter({} as any, config)
  await assert.rejects(
    (adapter as any).isolationConfig(connection, '/workspace', signal),
    /invalid config\/read apps/,
  )
})

test('primary App Server isolation treats absent mcp_servers and apps as empty', async () => {
  const signal = AbortSignal.timeout(5_000)
  const connection = {
    async request(method: string) {
      if (method === 'config/read') return { config: {} }
      if (method === 'skills/list') {
        return { data: [{ cwd: '/workspace', skills: [], errors: [] }] }
      }
      throw new Error(`unexpected method ${method}`)
    },
  }

  const adapter = new CodexAppServerAdapter({} as any, config)
  const isolation = await (adapter as any).isolationConfig(connection, '/workspace', signal)
  assert.deepEqual(isolation.mcp_servers, {})
  assert.deepEqual(isolation.apps, { _default: { enabled: false } })
})

test('primary App Server isolation fails closed when Codex skill discovery reports an error', async () => {
  const signal = AbortSignal.timeout(5_000)
  const connection = {
    async request(method: string) {
      if (method === 'config/read') return { config: {} }
      if (method === 'skills/list') {
        return {
          data: [{
            cwd: '/workspace',
            skills: [],
            errors: [{ path: '/workspace/.agents/skills/bad/SKILL.md', message: 'invalid frontmatter' }],
          }],
        }
      }
      throw new Error(`unexpected method ${method}`)
    },
  }

  const adapter = new CodexAppServerAdapter({} as any, config)
  await assert.rejects(
    (adapter as any).isolationConfig(connection, '/workspace', signal),
    /Codex skill discovery failed.*invalid frontmatter/,
  )
})
