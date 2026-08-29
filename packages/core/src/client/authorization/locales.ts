/** Copy dictionaries for Model Accounts UI. */

export const authEn = {
  nav: 'Model Accounts',
  title: 'Model Accounts',
  subtitle: 'Primary model account and authentication status',
  legacyGrant: 'Legacy Grant',
  legacyGrantNotice: 'A legacy DSH OAuth grant is still stored but is no longer used by the supported subscription path. In-app deletion is disabled because the current credential contract cannot remove only the observed grant atomically; remove the legacy record through the credential-store owner instead.',
  apiKeyConfiguredNotice: 'An API key is configured for this provider in Settings → Models.',
  statusNotConfigured: 'Not Configured',
  statusConnected: 'Connected',
  statusError: 'Sign In Error',
  refresh: 'Refresh Status',
  refreshAll: 'Refresh All',
  refreshing: 'Refreshing...',
  noFlows: 'No account status flows registered.',
}

export const authZh = {
  nav: '模型账号',
  title: '模型账号',
  subtitle: '主要模型账号与认证状态',
  legacyGrant: '旧版授权',
  legacyGrantNotice: '检测到旧版 DSH OAuth 授权，但受支持的订阅路径已不再使用它。当前凭据接口无法原子地只删除已观察到的旧授权，因此应用内删除已禁用；请通过凭据存储的所属工具移除该旧记录。',
  apiKeyConfiguredNotice: '该提供方的 API Key 已在 设置 → 模型 中配置。',
  statusNotConfigured: '未配置',
  statusConnected: '已连接',
  statusError: '登录出错',
  refresh: '刷新状态',
  refreshAll: '全部刷新',
  refreshing: '正在刷新...',
  noFlows: '未注册账号状态流程。',
}

export const en = authEn
export const zh = authZh
