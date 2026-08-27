# Core 13 — Web Search routing validation

Tested commit: bc2c868ba343637319359d59cd91c737ca1ed15d
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 0
Result: PASS

Вывод тестов `nishi-dsh-core`:
- Total tests: 164
- Suites: 0
- Pass: 164
- Fail: 0
- Cancelled: 0
- Skipped: 0
- Todo: 0
- Duration: ~920ms

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

Вывод: `tsc -p tsconfig.json --noEmit` завершился без ошибок компиляции и типов (exit code 0).

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

Вывод: `tsdown` успешно собрал все входные точки (`src/index.ts`, `src/runtime/index.ts`, `src/usage/index.ts`, `src/web-search/index.ts`, `src/client/index.ts`), сформировав ESM и CJS бандлы, а также сопутствующие `.d.ts` декларации без ошибок.

## Canonical route contract

`resolvePrimarySearchRoute(exec)` в `packages/core/src/web-search/route.ts` использует общий валидатор `canonicalProviderRoute(value, 'web_search primary provider route')` из `packages/core/src/registry/identity.ts`:

1. **Единые правила валидации**:
   - Provider descriptor registration (`registerProvider` в `packages/core/src/registry/index.ts`);
   - Registry lookup identity (`ctx.nishiProviders.byRoute(providerRoute)`);
   - Web Search request-header route resolution (`resolvePrimarySearchRoute(exec)`).

2. **Ограничения `canonicalProviderRoute`**:
   - `typeof value === 'string'` и `value.length > 0` (непустая строка);
   - `value === value.trim()` (отсутствие leading/trailing whitespace);
   - `!WHITESPACE.test(value)` (отсутствие пробелов и пробельных символов внутри);
   - `!CONTROL_CHARACTER.test(value)` (отсутствие ASCII control символов `[\u0000-\u001f\u007f]`);
   - `value.length <= MAX_PROVIDER_ROUTE_LENGTH` (не длиннее 128 символов).

3. **Fail closed без silent trim**:
   - Резолвер не выполняет silent trim или нормализацию невалидных строк.
   - Любое нарушение выбрасывает исключение, перехватываемое и преобразуемое в `PrimaryWebSearchError('WEB_SEARCH_ROUTE_UNAVAILABLE', ...)`.
   - Проверено поведение для невалидных значений:
     - `' codex-app-server '` -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
     - `'codex app-server'` -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
     - `'codex\tapp-server'` / newline -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
     - `'codex\u0000app-server'` (NUL) -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
     - `'r'.repeat(129)` (> MAX_PROVIDER_ROUTE_LENGTH) -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
   - Канонические строки (`codex-app-server`, `antigravity-cli`, `nebula-chat`) остаются валидными. Core не знает и не хардкодит фиксированный список provider ids.

## Error taxonomy

Обеспечено строгое разделение классов ошибок:

1. **`WEB_SEARCH_ROUTE_UNAVAILABLE`**:
   - Сигнализирует о повреждённых, отсутствующих или синтаксически невалидных метаданных сессии, заголовках запроса или невалидном route (provider/model).
   - Выбрасывается синхронно на этапе `resolvePrimarySearchRoute(exec)`.
   - Backend resolver и search backend при этом **не вызываются**.
   - Не означает отсутствие поисковой capability у провайдера.

2. **`WEB_SEARCH_UNSUPPORTED`**:
   - Сигнализирует о том, что canonical route успешно разрешён, но соответствующий backend отсутствует в реестре либо зарегистрирован без capability `webSearch` (`backend === undefined`).
   - Выбрасывается внутри `dispatchPrimarySearch(route, request, signal, resolveBackend)`.
   - Не означает malformed session metadata.

3. **Отсутствие fallback**:
   - При `WEB_SEARCH_UNSUPPORTED` не происходит попыток переключения на альтернативные провайдеры или внешние поисковые движки.

## Header shape

Проверка структуры `config` в `resolvePrimarySearchRoute`:

1. **Функция `plainObject(value)`**:
   ```ts
   function plainObject(value: unknown): value is Record<string, unknown> {
     if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
     const proto = Object.getPrototypeOf(value)
     return proto === Object.prototype || proto === null
   }
   ```
2. **Поведение на некорректных формах**:
   - `requestHeader()?.config === undefined` -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
   - `config = null` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (безопасно, без `TypeError: Cannot read properties of null`)
   - `config = []` -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
   - `config = 123` / `'str'` / `true` -> `WEB_SEARCH_ROUTE_UNAVAILABLE`
   - `config = Object.create(null)` -> принимается как plain data object, поля `provider` и `model` валидируются штатно.
   - `config = new Date()` / инстансы классов / экзотические прототипы -> отклоняются как не plain objects.
3. **Безопасность данных**:
   - Исключён небезопасный доступ к `config.provider` до проверки формы объекта.
   - Диагностические сообщения об ошибках не содержат дампов сырых объектов, credentials или чувствительных данных сессии.
   - Внутренние сообщения `canonicalProviderRoute` инкапсулируются в контролируемый текст `web_search found a request/header without a valid provider/model route`.

## Installed DSH compatibility

Проведено исследование пакетов DSH `0.1.1-rc.2` (`@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-tools`):

1. **Типы и контракты**:
   - Метод `Session.requestHeader()` возвращает `EpochHeader | undefined`.
   - Поле `EpochHeader.config` типизировано как `LlmCallConfig` (`{ provider: string; model: string; reasoningEffort?: ReasoningEffortId; ... }`).
2. **Runtime представление**:
   - События сессии при добавлении нормализуются через `snapshotJsonValue(data)` и замораживаются `deepFreeze(foldRequestHeader(...))`.
   - В runtime `agent.session.requestHeader()?.config` представляет собой `Object.freeze({...})` от стандартного plain JavaScript object literal с прототипом `Object.prototype`.
   - `plainObject(config)` вычисляет `Object.getPrototypeOf(config) === Object.prototype` и возвращает `true`.
3. **Совместимость**:
   - Новая проверка `plainObject` на 100% совместима с реальным runtime DSH `0.1.1-rc.2`.

## Registry dispatch

Проверен сквозной путь вызова:
```
tool.execute
-> resolvePrimarySearchRoute(exec)
-> runSearchQueries(route, queries, maxResults, signal, resolveBackend)
-> dispatchPrimarySearch(route, request, signal, resolveBackend)
-> resolveBackend(route.provider)
-> ctx.nishiProviders.byRoute(providerRoute)?.webSearch
```

- В качестве ключа реестра передаётся точный канонический `route.provider`.
- Вызовы `.trim()` или rewrite строк перед `byRoute` отсутствуют.
- Hardcoded переключатели провайдеров и таблицы соответствий отсутствуют.
- Нейтральность Core 10 полностью соблюдена.

## Model and optional fields

1. **Provider-owned model ID**:
   - В отличие от provider route, `model` проверяется как `nonBlankString(config.model)`.
   - Это решение проектно обусловлено: идентификатор модели (`gpt-5.6-sol`, `gemini-3.7-flash-medium`, `claude-3-7-sonnet@20250219` и др.) является непрозрачным идентификатором вендора, и Core намеренно не накладывает искусственных грамматических ограничений сверх непустой строки.
   - Пустая строка `""` или строка только из пробелов `"   "` отклоняются (`WEB_SEARCH_ROUTE_UNAVAILABLE`).
   - Валидный model id передаётся в backend без изменений (`route.model`).
2. **Опциональные поля**:
   - `reasoningEffort`: опциональная непустая строка (`nonBlankString(config.reasoningEffort)`).
   - `cwd`: опциональная непустая строка (`nonBlankString(agent.session.header.cwd)`). Пути с пробелами (например, `C:/Program Files/...`) валидны и не подвергаются canonical provider route валидации.
   - Поля `reasoningEffort` и `cwd` не участвуют в выборе backend'а.

## Regression tests

Анализ теста `missing or malformed route fails closed with WEB_SEARCH_ROUTE_UNAVAILABLE` в `packages/core/test/web-search.test.ts`:

1. **Почему новые кейсы ловят старую реализацию**:
   - Предыдущая реализация (`typeof value === 'string' && value.trim().length > 0`) считала строки `' codex-app-server '`, `'codex app-server'`, строки с табами, переводами строк, NUL и оверлейные строки валидными. После этого exact lookup в реестре не находил backend, ошибочно выдавая `WEB_SEARCH_UNSUPPORTED` вместо `WEB_SEARCH_ROUTE_UNAVAILABLE`.
   - Предыдущая реализация обращалась к `config.provider` без проверки plain object, что на `config: null` приводило к `TypeError: Cannot read properties of null` вместо контролируемой ошибки.
2. **Параметры тест-кейсов**:
   - Тест на превышение длины использует `MAX_PROVIDER_ROUTE_LENGTH + 1` (`129` символов).
   - Тест на NUL содержит реальный code point `\u0000`.
   - Тест на tab содержит реальный `\t`.
   - Динамическое переключение (`Codex -> Antigravity -> Codex`) подтверждает чтение `requestHeader()?.config` на каждый вызов без кэширования старого роута.
   - Тест на неподдерживаемый канонический провайдер возвращает `WEB_SEARCH_UNSUPPORTED`, подтверждая разделение таксономии ошибок.

## Additional review

Проведены дополнительные проверки граничных случаев (edge-case probe):
- `provider = new String('codex-app-server')` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `provider = 123` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `provider = '\ncodex-app-server'` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `provider = 'codex-app-server\n'` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `provider = 'codex\u2003app-server'` (Unicode whitespace) -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `config = new Date()` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `config = () => {}` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `config = [1, 2, 3]` -> `WEB_SEARCH_ROUTE_UNAVAILABLE` (PASS)
- `config = Object.create(null)` с валидными полями -> успешно формирует `PrimarySearchRoute` (PASS)

NO BLOCKING ISSUES FOUND.

## Working tree

- Состояние до проверки: чистый working tree на ветке `feat/core-provider-plugins-rc3`.
- Проверены коммиты:
  - `165bc7bdb2c5ad7bddcfeaeaebf627837bd0122a` (`fix(core): validate web search primary routes canonically`)
  - `bc2c868ba343637319359d59cd91c737ca1ed15d` (`test(core): cover malformed web search primary routes`)
- Создан отчёт: `docs/verification/gemini/core-13-web-search-routing.md`.

## Verdict

PASS
