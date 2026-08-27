# Core 14 — Final core acceptance

Tested commit: 65cc30f53b06fa44ff0b12fde3337df142f62d98
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0
DSH: 0.1.1-rc.2

## Previous blocker

В предыдущем запуске Core 14 реальный DSH profile boot завершился с ошибкой:
```
Error: dsh: plugin tree failed to load: failed to apply loader entry nishi-core (nishi-dsh-core): cannot get property "nishiProviders" without inject
```
Причина заключалась в конфликте старого lifecycle:
- Внешний плагин `nishi-core` регистрировал `NishiProvidersService` внутри `apply(ctx)`.
- Тот же самый контекст `ctx` немедленно передавался в `new UsageLimitsHostService(ctx)` -> `composeUsageLimitsHost(ctx)`, где вызывался `ctx.nishiProviders.all()`.
- При этом `NishiCorePlugin.inject` содержал только `['connection', 'credentials']`.
- В Cordis 4.x контекст плагина проксируется и запрещает доступ к любым сервисам, не объявленным в `inject`.
- Добавить `nishiProviders` в `inject` внешнего `nishi-core` было невозможно, так как возник бы циклический дедлок: плагин ожидал бы сервис, который сам должен был создать.

## Lifecycle fix

Исправление внесено в коммитах:
- Production fix: `5fe1867000ca9836107ea3bfa61cac967f5d0079`
- Regression tests: `65cc30f53b06fa44ff0b12fde3337df142f62d98`

Новая архитектура lifecycle:
1. **Outer plugin `nishi-core`**:
   - `inject: [] as const` (не имеет внешних сервис-зависимостей).
   - В `apply(ctx)` монтирует два дочерних плагина:
     1. `ctx.plugin(NishiProvidersService)` — регистрирует Cordis-сервис `nishiProviders` на рутовом контексте.
     2. `ctx.plugin(hostPlugin(config))` — монтирует внутренний child host плагин.
2. **Internal host plugin `nishi-core-host`**:
   - `name: 'nishi-core-host'`
   - `inject: ['nishiProviders', 'connection', 'credentials'] as const`
   - В `apply(hostCtx)` безопасно обращается ко всем трем сервисам:
     - Создает `UsageLimitsHostService(hostCtx, config)` с доступом к `hostCtx.nishiProviders`.
     - Создает `AuthorizationHostController(hostCtx)` с доступом к `hostCtx.credentials`.
     - Регистрирует RPC-хэндлеры на `hostCtx.connection.rpc`.

## Cordis lifecycle review

1. **Child Fiber Ownership**:
   - В `@deepseek-ai/cordis@4.0.1` вызовы `ctx.plugin(...)` внутри `apply()` создают дочерние fibers, привязанные к lifecycle родительского плагина `nishi-core`.
   - При выгрузке (`coreFiber.dispose()`) дочерние плагины `NishiProvidersService` и `nishi-core-host` автоматически и корректно уничтожаются.
2. **Порядок активации**:
   - `NishiProvidersService` монтируется первым и немедленно публикует `ctx.nishiProviders`.
   - Дочерний `nishi-core-host` активируется штатно, как только готовы `nishiProviders`, `connection` и `credentials`.
   - Провайдеры (`nishi-codex`, `nishi-antigravity`, `nishi-claude`) зависят от `nishiProviders` через собственный `inject` и активируются без задержек и deadlock'ов.
3. **Отсутствие обходов**:
   - Нет несанкционированных приведений `(ctx as any)`.
   - Доступ к Cordis proxy осуществляется строго по правилам `inject`.

## Local gate

### verify:local
Command: `pnpm verify:local`
Exit code: 0
Result: PASS

Детализация:
- release-family validation: PASS
- package contracts: PASS
- orchestrator validation: PASS
- workspace build: PASS
- workspace check: PASS
- workspace tests: PASS (274/274 tests passed):
  - `nishi-dsh-core`: 165 passed, 0 failed
  - `nishi-dsh-project-memory`: 28 passed, 0 failed
  - `nishi-dsh-codex`: 31 passed, 0 failed
  - `nishi-dsh-antigravity`: 7 passed, 0 failed
  - `nishi-dsh-claude`: 31 passed, 0 failed
  - `nishi-dsh-suite`: 12 passed, 0 failed
- local packaging: PASS (6 tarballs packed в `.artifacts/packs/`)

## Packages

Сформировано ровно 6 tarball версии `0.1.0-rc.3`:
- `nishi-dsh-antigravity-0.1.0-rc.3.tgz`
- `nishi-dsh-claude-0.1.0-rc.3.tgz`
- `nishi-dsh-codex-0.1.0-rc.3.tgz`
- `nishi-dsh-core-0.1.0-rc.3.tgz`
- `nishi-dsh-project-memory-0.1.0-rc.3.tgz`
- `nishi-dsh-suite-0.1.0-rc.3.tgz`

Содержимое `nishi-dsh-core-0.1.0-rc.3.tgz`:
- `package/package.json`
- `package/lib/index.js`, `package/lib/index.d.ts`
- `package/lib/runtime.js`, `package/lib/runtime.d.ts`
- `package/lib/usage.js`, `package/lib/usage.d.ts`
- `package/lib/web-search.js`, `package/lib/web-search.d.ts`
- `package/lib/client.js`, `package/lib/client.d.ts`
- `package/LICENSE`, `package/README.md`, `package/THIRD_PARTY_NOTICES.md`

Запрещенные каталоги (`src/`, `test/`, `node_modules/`), `.env`, credentials, vendor sessions отсутствуют.

## Vendor protocol smoke

Command: `pnpm smoke:vendor-cli`
Exit code: 0
- Codex: PASS (codex-cli 0.150.0, rate-limits snapshot normalized OK, status=AVAILABLE, windows=4, hasExtraUsage=true)
- Antigravity: PASS (agy 1.1.22, listModels() returned 14 model(s) with expected shape)
- Claude: PASS (Claude Code 2.1.246, usage snapshot normalized OK, status=AVAILABLE, windows=2, hasExtraUsage=true)

Summary: 3 passed, 0 skipped, 0 failed.

## Disposable profile

- Disposable DSH_HOME: `/tmp/nishi-core-rc3-rerun-uJwEHv` (полностью изолирован от `~/.dsh`).
- Profile name: `nishi-core-rc3-acceptance`
- DSH version: `0.1.1-rc.2`
- Управление профилем: через команду `dsh plugin --profile nishi-core-rc3-acceptance add ...`.

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
- installed dependency closure чист от запрещенных runtime;
- package family разрешается из local rc.3 tarball;
- safety checks пройдены.

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

Все 5 subpaths успешно экспортируются и разрешаются.

## DSH host boot

Command:
```bash
DSH_HOME="$CORE_ACCEPTANCE_HOME" dsh --profile nishi-core-rc3-acceptance --no-open --port 38245
```
Exit code: 0 (успешный graceful boot и остановка)
Result: PASS

Процедура верификации:
1. Запуск DSH веб-сервера в фоне на свободном порту `38245`.
2. Ожидание readiness: процесс успешно запустился и вывел `dsh web: http://127.0.0.1:38245`.
3. HTTP-запрос `curl http://127.0.0.1:38245` вернул статус `200 OK`.
4. Процесс штатно остановлен через `SIGTERM`.

Регрессия `cannot get property "nishiProviders" without inject`: **PASS** (ошибка полностью устранена, лог чист).

## Plugin lifecycle

- `outer` (`nishi-core`, inject: `[]`): активируется немедленно.
- `child/service` (`NishiProvidersService`): регистрирует сервис `nishiProviders`.
- `child` (`nishi-core-host`, inject: `['nishiProviders', 'connection', 'credentials']`): активируется при готовности зависимостей.
- `providers` (`nishi-codex`, `nishi-antigravity`, `nishi-claude`): активируются при наличии `nishiProviders` и собственных runtime зависимостей.
- Deadlock и постоянный deferred-статус отсутствуют.

## Agent-plane web search mount

- Row `nishi-dsh-core/web-search` в Orchestrator agent preset (`presets/orchestrator/agent.cordis.yml`):
  ```yaml
  - id: tool-web
    name: 'nishi-dsh-core/web-search'
    config:
      searchTimeoutMs: 60000
  ```
- Subpath успешно разрешается, монтируется в Cordis context, регистрирует системный промпт `tool:web_search` и tool `web_search`.
- Ошибки `ERR_PACKAGE_PATH_NOT_EXPORTED` и `missing nishiProviders` отсутствуют.

## Host/browser smoke

- Browser client entry (`lib/client.js`) успешно импортируется.
- Usage limits RPC (`/usage-limits`) и Authorization RPC (`/authorization`) зарегистрированы на `ctx.connection.rpc`.
- DSH Host Web Server успешно стартовал и отвечает `200 OK`.

## Primary turn

- Headless invocation: `DSH_HOME="$CORE_ACCEPTANCE_HOME" dsh --profile headless "Reply with exactly: CORE_ACCEPTANCE_OK"`
- Result: **AUTH BLOCKED** (в чистом изолированном disposable DSH_HOME отсутствуют vendor credentials / API keys).
- Автоматический логин и манипуляции с credentials не производились в соответствии с правилами acceptance.

## Web Search runtime

- Agent-plane плагин `nishi-dsh-core/web-search` успешно смонтирован.
- Tool `web_search` зарегистрирован с поддержкой пакетных запросов (1–${maxQueries}), схемой вывода источников и markdown-форматированием.
- Маршрутизация использует канонический primary provider route без DeepSeek fallback.

## Unload/reload

- Выполнен проверочный цикл на `@deepseek-ai/cordis@4.0.1`:
  1. Монтирование `NishiCorePlugin`.
  2. Размонтирование (`dispose()`).
  3. Повторное монтирование `NishiCorePlugin`.
- Проверено отсутствие дублирования сервисов `nishiProviders`, `usageLimits` и каналов RPC (`/usage-limits`, `/authorization`).

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
- Core 11 (Root inject contract): **SUPERSEDED BY CORE 14 LIFECYCLE FIX** (outer `inject: []`, child host `inject: ['nishiProviders', 'connection', 'credentials']`)
- Core 12 (No direct dsh-authorization dependency): PASS
- Core 13 (Web Search route/header boundary): PASS
- Core 14 (Final Core Acceptance rerun): PASS

## Dependency closure

- `rg -i "@openai/codex|@anthropic-ai" packages/*/package.json pnpm-lock.yaml`: 0 совпадений (PASS).
- `node scripts/verify-bundle-install.mjs --closure-only`: PASS (vendor-runtime closure clean).
- Foreign platform binaries под `@openai` / `@anthropic-ai` отсутствуют.

## Working tree

- До acceptance: чистый (`65cc30f53b06fa44ff0b12fde3337df142f62d98`)
- После acceptance: чистый за исключением обновленного `docs/verification/gemini/core-14-final-acceptance.md`

## Blocking issues

NO BLOCKING ISSUES FOUND.

## Verdict

PASS
