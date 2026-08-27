# Core 12 — Authorization dependency removal

Tested commit: 074d778809ff91a81a74145b05355d375a5eb3f0
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Lockfile

Выполнена детерминированная регенерация через `pnpm install --lockfile-only`.

Lockfile commit: 074d778809ff91a81a74145b05355d375a5eb3f0

- **Изменившийся importer**: `packages/core` (importers['packages/core']).
- **Удалённые строки**:
  ```yaml
  -      '@deepseek-ai/dsh-authorization':
  -        specifier: 0.1.1-rc.2
  -        version: 0.1.1-rc.2(e0350187351f9d964689a3e0122aa410)
  ```
- **Посторонние изменения**: отсутствуют. Diff чистый и минимальный (3 строки удалены в секции dependencies importer'а `packages/core`).

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 0
Result: PASS

Вывод тестов:
- Total tests: 164
- Suites: 0
- Pass: 164
- Fail: 0
- Cancelled: 0
- Skipped: 0
- Todo: 0
- Duration: ~980ms

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

Вывод: `tsc -p tsconfig.json --noEmit` завершился без ошибок (exit code 0).

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

Вывод: `tsdown` собрал все входные точки (`src/index.ts`, `src/runtime/index.ts`, `src/usage/index.ts`, `src/web-search/index.ts`, `src/client/index.ts`), сформировав ESM и CJS бандлы, а также сопутствующие `.d.ts` декларации без ошибок.

## Manifest boundary

Проверено состояние `packages/core/package.json`:
- `dependencies`: `@deepseek-ai/dsh-authorization` отсутствует (объявлен только `@deepseek-ai/schemastery`).
- `peerDependencies`: `@deepseek-ai/dsh-authorization` отсутствует.
- `devDependencies`: `@deepseek-ai/dsh-authorization` отсутствует.

Автоматическая гарантия обеспечена тестом `nishi-dsh-core has no dependency on the unused DSH authorization package` в `packages/core/test/package-boundary.test.ts`.

## Source and build boundary

1. **Поиск по исходным файлам (`packages/core/src`)**:
   - `rg -n "@deepseek-ai/dsh-authorization" packages/core/src` вернул 0 совпадений.
   - Поиск по subpaths `@deepseek-ai/dsh-authorization/...` вернул 0 совпадений.
2. **AST-тест границы (`packages/core/test/package-boundary.test.ts`)**:
   - Тест `core source does not import the unused DSH authorization package` рекурсивно обходит все `.ts` и `.tsx` файлы в `packages/core/src`.
   - Использует парсер TypeScript (`ts.createSourceFile`) для извлечения исполняемых строковых литералов (`ts.isStringLiteralLike`).
   - Проверяет условие `value === AUTHORIZATION_PACKAGE || value.startsWith(`${AUTHORIZATION_PACKAGE}/`)`.
   - Гарантирует отсутствие статических/динамических импортов и require-подобных строковых литералов пакета и его субпутей без ложных срабатываний на комментариях.
3. **Артефакты сборки (`packages/core/lib`)**:
   - `rg -n "@deepseek-ai/dsh-authorization" packages/core/lib` — 0 совпадений.
   - `rg -n "dsh-authorization" packages/core/lib` — 0 совпадений.
   - Ни runtime bundle, ни client bundle, ни сгенерированные `.d.ts` файлы типов не содержат ссылок на пакет авторизации.

## Authorization behavior

Model Accounts RPC surface в `packages/core/src/host/authorization-rpc.ts` функционирует штатно через сервис `credentials` без использования пакета `@deepseek-ai/dsh-authorization` и сервиса `ctx.authorization`:

1. **`list-flows` (`AUTH_GET_FLOWS_ENDPOINT`)**: возвращает публичные DTO для провайдеров чтения (`openai-codex`, `anthropic`, `openai`).
2. **`get-provider-status` (`AUTH_GET_STATUS_ENDPOINT`)**:
   - Формирует ключ через `credentialKey('llm-pi-ai', providerId)` из `@deepseek-ai/dsh-credentials`.
   - Запрашивает статус через `ctx.credentials.describeRecord(key)`.
   - Возвращает статус `CONNECTED` при наличии grant-записи, иначе `NOT_CONFIGURED`.
3. **`logout` (`AUTH_LOGOUT_ENDPOINT`)**:
   - Проверяет тип записи через `ctx.credentials.describeRecord(key)`.
   - Если запись типа `grant`, удаляет её через `ctx.credentials.deleteRecord(key)`.
   - Работает только для разрешённых legacy провайдеров (`openai-codex`, `anthropic`).
4. **Subscription OAuth**:
   - `MUTATING_PROVIDER_IDS` пуст — прямой subscription login через DSH отключён.
   - Эндпоинты `begin-login`, `submit-prompt`, `cancel-login` отклоняются на уровне RPC-хендлера с generic ошибкой `bad-request` (`Invalid authorization request.`).
5. **Безопасность данных**:
   - Секретные токены (`accessToken` и др.) не включаются в DTO и не проецируются в браузер.
   - Исключения хоста маскируются в generic `internal` ошибку (`Authorization operation failed.`).

## Dependency graph

Команда `pnpm why @deepseek-ai/dsh-authorization` в корне workspace:
```
@deepseek-ai/dsh-authorization@0.1.1-rc.2
└── nishi-dsh-suite@0.1.0-rc.3 (dependencies)
```

- `@deepseek-ai/dsh-authorization` присутствует в монорепозитории только как прямая зависимость корневого метапакета `nishi-dsh-suite`.
- `nishi-dsh-core` полностью изолирован от `@deepseek-ai/dsh-authorization`: не объявляет его в манифесте, не импортирует в исходниках и не требует в build output.

## Regression review

Все предыдущие core-инварианты подтверждены и остаются зелёными:
- **Core 09**: изоляция от `@deepseek-ai/dsh-subagent` (отсутствует в манифесте, AST-проверка пройдена).
- **Core 10**: нейтральность провайдеров (отсутствие hardcoded provider packages и id в core).
- **Core 11**: сужение root injection до `['connection', 'credentials']` (сервис `authorization` не запрашивается).
- **Authorization RPC**: тесты `authorization-rpc.test.ts` пройдены.
- **Usage & Limits**: жизненный цикл, absence fallback (`UNSUPPORTED`), кэширование и RPC работают штатно.
- **Browser lifecycle**: монтирование UI слотов, sidebar, settings и locale работает без сбоев.
- **Registration rollback**: откат и изоляция провайдеров при сбоях регистрации сохраняются.
- **Workspace confinement**: изоляция путей и безопасная очистка временных рабочих директорий работают штатно.
- **Failure contract**: нормализация ошибок вендоров без утечки сырых дампов сохраняется.
- **Все пакеты workspace**: 245 тестов во всех пакетах (`nishi-dsh-core`, `nishi-dsh-codex`, `nishi-dsh-antigravity`, `nishi-dsh-claude`, `nishi-dsh-suite`) успешно пройдены.

## Future cleanup candidates

- **`@deepseek-ai/dsh-client-test-runtime` в `packages/core/package.json`**:
  - Объявлен в `devDependencies` (`0.1.1-rc.2`).
  - Не импортируется ни в `packages/core/src`, ни в `packages/core/test`.
  - Кандидат на удаление в рамках будущей очистки неиспользуемых dev-зависимостей (в рамках Core 12 изменения не вносились).

## Additional review

NO BLOCKING ISSUES FOUND.

## Working tree

- Исходное состояние: ветка `feat/core-provider-plugins-rc3`, fast-forward pull до коммитов `912984a` (удаление dependency) и `7256f27` (тесты границы).
- Регенерация lockfile: зафиксирован коммит `074d778` (`chore: refresh lockfile after authorization cleanup`).
- Создан отчёт: `docs/verification/gemini/core-12-authorization-dependency.md`.

## Verdict

PASS

Критерии выполнения:
- Node.js 24 (v24.19.0) — PASS
- `pnpm install --lockfile-only` детерминирован и минимален — PASS
- `pnpm --filter nishi-dsh-core test` exit 0 (164/164 tests pass) — PASS
- `pnpm --filter nishi-dsh-core check` exit 0 (0 type errors) — PASS
- `pnpm --filter nishi-dsh-core build` exit 0 (чистая сборка) — PASS
- Прямая зависимость `@deepseek-ai/dsh-authorization` удалена из `dependencies`, `peerDependencies`, `devDependencies` — PASS
- Импорты в `src` и `lib` отсутствуют — PASS
- Поведение Model Accounts RPC сохранено через `credentials` — PASS
- Блокирующие проблемы отсутствуют — PASS
