# Core 14 — Final core acceptance

Tested commit: f071832b56894a0998ab5f2fdd5b9bc6706b1e2e
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0
DSH: 0.1.1-rc.2

## Local gate

### verify:local
Command: `pnpm verify:local`
Exit code: 0
Result: PASS

Детали:
- release-family validation: PASS
- package contracts: PASS
- orchestrator validation: PASS
- workspace build: PASS
- workspace check: PASS
- workspace tests: PASS (164/164 core, 31/31 codex, 7/7 antigravity, 31/31 claude, 12/12 suite, 28/28 project-memory)
- local packaging: PASS (6 tarballs packed)

## Packages
Шесть rc.3 tarball созданы в `.artifacts/packs/`:
- `nishi-dsh-antigravity-0.1.0-rc.3.tgz` (29990 bytes)
- `nishi-dsh-claude-0.1.0-rc.3.tgz` (9657 bytes)
- `nishi-dsh-codex-0.1.0-rc.3.tgz` (44545 bytes)
- `nishi-dsh-core-0.1.0-rc.3.tgz` (66384 bytes)
- `nishi-dsh-project-memory-0.1.0-rc.3.tgz` (21113 bytes)
- `nishi-dsh-suite-0.1.0-rc.3.tgz` (11968 bytes)

### Содержимое nishi-dsh-core-0.1.0-rc.3.tgz
Production exports:
- `package/package.json`
- `package/lib/index.js`
- `package/lib/index.d.ts`
- `package/lib/runtime.js`
- `package/lib/runtime.d.ts`
- `package/lib/usage.js`
- `package/lib/usage.d.ts`
- `package/lib/web-search.js`
- `package/lib/web-search.d.ts`
- `package/lib/client.js`
- `package/lib/client.d.ts`

Exports в package.json:
- `.`
- `./runtime`
- `./usage`
- `./web-search`
- `./client`
- `./package.json`

Tarball не содержит `src/`, `test/`, `node_modules/`, credential files, vendor sessions, `.env`, git metadata.

## Vendor protocol smoke
Command: `pnpm smoke:vendor-cli`
Exit code: 0
- Codex: PASS (codex-cli 0.150.0, rate-limits snapshot normalized OK, status=AVAILABLE, windows=4, hasExtraUsage=true)
- Antigravity: PASS (agy 1.1.22, listModels() returned 14 model(s) with expected shape)
- Claude: PASS (Claude Code 2.1.246, usage snapshot normalized OK, status=AVAILABLE, windows=2, hasExtraUsage=true)

Summary: 3 passed, 0 skipped, 0 failed.

## Disposable profile
- Strategy: `CORE_ACCEPTANCE_HOME="$(mktemp -d /tmp/nishi-core-rc3-XXXXXX)"`
- Profile name: `nishi-core-rc3-acceptance`
- DSH version: `0.1.1-rc.2`
- Profile creation: инициализируется командой `dsh plugin --profile nishi-core-rc3-acceptance add <package>` или `dsh --profile nishi-core-rc3-acceptance`.
- Disposable DSH_HOME: `/tmp/nishi-core-rc3-rxBVNW` (изолирован от `~/.dsh`).

## Bundle install
Command:
```bash
node scripts/verify-bundle-install.mjs \
  --profile nishi-core-rc3-acceptance \
  --suite .artifacts/packs/nishi-dsh-suite-0.1.0-rc.3.tgz \
  --dsh-home "$CORE_ACCEPTANCE_HOME" \
  --local-pack-dir .artifacts/packs \
  --dsh-bin dsh
```
Exit code: 0
Result: PASS

Подтверждено:
- Suite dependency установлена;
- bundle зарегистрирован ровно один раз;
- reinstall/update lifecycle не создает дубликатов;
- installed dependency closure корректен;
- package family разрешается из local rc.3 tarball;
- uninstall/reinstall safety checks пройдены.

## Installed family
Фактическая dependency tree в disposable profile (`dsh plugin --profile nishi-core-rc3-acceptance list --depth 0 --json`):
- `nishi-dsh-suite`: 0.1.0-rc.3
- `nishi-dsh-core`: 0.1.0-rc.3
- `nishi-dsh-project-memory`: 0.1.0-rc.3
- `nishi-dsh-codex`: 0.1.0-rc.3
- `nishi-dsh-antigravity`: 0.1.0-rc.3
- `nishi-dsh-claude`: 0.1.0-rc.3

## Core subpath exports
Результаты `import.meta.resolve()` из каталога disposable profile:
- `nishi-dsh-core` -> `[profile]/node_modules/nishi-dsh-core/lib/index.js`
- `nishi-dsh-core/runtime` -> `[profile]/node_modules/nishi-dsh-core/lib/runtime.js`
- `nishi-dsh-core/usage` -> `[profile]/node_modules/nishi-dsh-core/lib/usage.js`
- `nishi-dsh-core/web-search` -> `[profile]/node_modules/nishi-dsh-core/lib/web-search.js`
- `nishi-dsh-core/client` -> `[profile]/node_modules/nishi-dsh-core/lib/client.js`

Все 5 subpaths успешно экспортируются и резолвятся из установленного пакета в disposable profile.

## DSH host boot
Command: `DSH_HOME="$CORE_ACCEPTANCE_HOME" dsh --profile nishi-core-rc3-acceptance --no-open --port 38123`
Exit code: 1
Result: FAIL

Boot failure trace:
```
Error: dsh: plugin tree failed to load: failed to apply loader entry nishi-core (nishi-dsh-core): cannot get property "nishiProviders" without inject
Error: cannot get property "nishiProviders" without inject
    at reconcile (node_modules/nishi-dsh-core/lib/index.js)
    at composeUsageLimitsHost (node_modules/nishi-dsh-core/lib/index.js)
    at new UsageLimitsHostService (node_modules/nishi-dsh-core/lib/index.js)
    at new apply (node_modules/nishi-dsh-core/lib/index.js)
    at Fiber.execute (node_modules/@deepseek-ai/cordis/lib/index.js)
```

Причина:
В `packages/core/src/index.ts` объявлен `export const inject = ['connection', 'credentials'] as const`.
При вызове `apply(ctx)` вызывается `new UsageLimitsHostService(ctx, config)` -> `composeUsageLimitsHost(ctx, ...)` -> `ctx.nishiProviders.all()`.
Так как контекст плагина `nishi-core` не имеет `'nishiProviders'` в своем `inject`, Cordis 4.x перехватывает обращение к проксированному свойству `ctx.nishiProviders` и выбрасывает ошибку `cannot get property "nishiProviders" without inject`.

## Agent-plane web search mount
- Субпуть `nishi-dsh-core/web-search` прописан в Orchestrator preset (`presets/orchestrator/agent.cordis.yml`):
  ```yaml
  - id: tool-web
    name: 'nishi-dsh-core/web-search'
    config:
      searchTimeoutMs: 60000
  ```
- Subpath успешно разрешается (`nishi-dsh-core/web-search` -> `lib/web-search.js`), содержит валидный Cordis plugin contract (`inject = ['nishiProviders', 'tools', 'systemPrompt']`), но из-за падения boot хоста `nishi-core` полный запуск agent session не состоялся.

## Host/browser smoke
- Сборка browser client entry (`lib/client.js`) успешно импортируется.
- Регрессионные и контрактные тесты Usage Limits RPC (`/usage-limits`) и Authorization RPC (`/authorization`) пройдены в `verify:local`.
- Прямой live DSH host RPC smoke заблокирован из-за сбоя активации `nishi-core` на этапе boot профиля DSH.

## Primary turn
Provider: N/A
Result: BLOCKED
Причина: DSH profile boot завершается с ошибкой `cannot get property "nishiProviders" without inject` до запуска runtime сессии.

## Web Search runtime
- Mount result: Subpath entry `nishi-dsh-core/web-search` валиден, декларирует требуемые `inject` (`nishiProviders`, `tools`, `systemPrompt`) и экспортирует `applyPrimaryWebSearchTool`.
- Live query: Не выполнялся из-за сбоя boot хост-плагина `nishi-core`.

## Core invariants
- Core 01 (Usage lifecycle generation race): PASS
- Core 02 (UTF-8 split chunks): PASS
- Core 03 (Canonical provider identities/routes): PASS
- Core 04 (Workspace confinement): PASS
- Core 05 (Transactional provider registration rollback): PASS
- Core 06 (Usage capability absence): PASS
- Core 07 (Browser lifecycle): PASS
- Core 08 (VendorFailure + deterministic RegExp): PASS
- Core 09 (No direct dsh-subagent dependency): PASS
- Core 10 (Provider neutrality): PASS
- Core 11 (Root inject): FAIL (отсутствие `nishiProviders` в root `inject` блокирует runtime-доступ к `ctx.nishiProviders` в Cordis 4.x)
- Core 12 (No direct dsh-authorization dependency): PASS
- Core 13 (Web Search route/header boundary): PASS

## Dependency closure
- `rg -i "@openai/codex|@anthropic-ai" packages/*/package.json pnpm-lock.yaml`: 0 совпадений (PASS).
- `node scripts/verify-bundle-install.mjs --closure-only`: PASS (vendor-runtime closure clean).
- Foreign platform binaries под `@openai` / `@anthropic-ai` отсутствуют.

## Working tree
- До acceptance: чистый (Tested commit `f071832b56894a0998ab5f2fdd5b9bc6706b1e2e`)
- После acceptance: чистый за исключением `docs/verification/gemini/core-14-final-acceptance.md`

## Blocking issues
1. **Cordis 4 `inject` violation in `nishi-core` host plugin**:
   - `packages/core/src/index.ts` объявляет `export const inject = ['connection', 'credentials'] as const`.
   - В теле `apply(ctx)` происходит немедленное синхронное обращение к `ctx.nishiProviders` через `new UsageLimitsHostService(ctx)` -> `composeUsageLimitsHost(ctx)` -> `ctx.nishiProviders.all()`.
   - В Cordis 4.x любое обращение к сервису через `ctx.<service>` требует явного объявления `<service>` в массиве `inject` соответствующего плагина. Так как `'nishiProviders'` отсутствует в `inject` `nishi-core`, обращение выбрасывает `Error: cannot get property "nishiProviders" without inject`.
   - Профиль DSH с установленным Suite падает при попытке запуска (`dsh --profile ...` завершается с exit code 1).

## Verdict
FAIL

Причина: Real DSH profile boot завершается с ошибкой `cannot get property "nishiProviders" without inject` при активации `nishi-core`.
