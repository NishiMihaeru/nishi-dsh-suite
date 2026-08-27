# Core 01 — Usage lifecycle validation

Tested commit: 1237bc360c4b3bd198eb84ccd966c4fbab60a1fe
Branch: feat/core-provider-plugins-rc3

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 1
Result: FAIL

Output:
```
✖ failing tests:

test at test/stderr.test.ts:1:906
✖ settledStderr falls back to a bounded wait when the process never settles (8.683402ms)
  'Promise resolution is still pending but the event loop has already resolved'

test at test/stderr.test.ts:1:1151
✖ settledStderr returns undefined when no stderr reader is present
  'Promise resolution is still pending but the event loop has already resolved'

test at test/stderr.test.ts:1:1409
✖ settledStderr swallows a throwing stderr reader and returns undefined
  'Promise resolution is still pending but the event loop has already resolved'

test at test/stderr.test.ts:1:1614
✖ settledStderr rejects a non-positive graceMs
  'Promise resolution is still pending but the event loop has already resolved'

test at test/stderr.test.ts:1:1795
✖ settledStderr rejects a graceMs above MAX_TIMER_DELAY_MS
  'Promise resolution is still pending but the event loop has already resolved'
/home/acedia/Проекты/nishi-dsh-suite/packages/core:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] nishi-dsh-core@0.1.0-rc.3 test: `tsx --import ./test/register-css.mjs --test test/*.test.ts`
Exit status 1
```

Примечание: тест жизненного цикла `packages/core/test/usage-lifecycle.test.ts` проходит успешно (`✔ a withdrawn usage generation cannot overwrite or clear the replacement generation`). Ошибка вызвана несвязанным тестом `test/stderr.test.ts` (конфликт незавершённого промиса / таймера с ранним завершением event loop в Node.js v22 test runner).

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

## Regression scenario
Тест `packages/core/test/usage-lifecycle.test.ts` воспроизводит гонку жизненного цикла при дерегистрации и повторной регистрации провайдера с тем же `providerId`:
1. Регистрируется первое поколение провайдера (gen 1) с управляемым через `deferred()` collector'ом.
2. Запускается `firstRefresh` (`{ force: true }`), который переходит в ожидание разрешения промиса `firstGate`.
3. До завершения сбора данных вызывается `withdrawFirst()`.
4. Регистрируется второе поколение провайдера (gen 2) с тем же `providerId` и отдельным `secondGate`.
5. Запускается `secondRefresh` (`{ force: true }`) для gen 2.
6. Разрешается промис сбора данных старого поколения (`firstGate.resolve(...)`).

Тест доказывает, что:
- Запрос старого поколения `firstRefresh` завершается с исключением (`UsageContractError: Provider "fixture" registration changed during refresh`) и не перезаписывает кеш.
- `finally` блок старого refresh не удаляет активный `inFlight` промис второго поколения: последующий `secondJoin` успешно присоединяется к уже существующему `inFlight` промису без повторного вызова `collector.collect()`.
- После разрешения сбора данных второго поколения (`secondGate.resolve(...)`) оба вызова (`secondRefresh` и `secondJoin`), а также `getCachedSnapshot()` возвращают снимок нового поколения (`NEW GENERATION`).

## Code review
NO BLOCKING ISSUES FOUND.

Реализация generation guard в `UsageLimitsService` логически корректна:
1. **Токен поколения**: Каждый вызов `register()` создает уникальный объект `entry` (`UsageProviderRegistration`), служащий токеном поколения.
2. **Защита кеша от устаревшего refresh**: В теле асинхронного `refreshPromise` перед сохранением в кеш проверяется `if (this.registrations.get(providerId) !== reg)`, что гарантирует выброс ошибки и запрет записи устаревших данных при смене поколения.
3. **Защита дедупликации in-flight**: Структура `InFlightRefresh` хранит ссылку на объект `registration`. В `refreshProvider` повторный запрос присоединяется к `existingInFlight` только при условии `existingInFlight?.registration === reg`.
4. **Защита очистки finally**: В блоке `finally` удаление из `inFlight` происходит только при совпадении как регистрации (`active?.registration === reg`), так и самого промиса (`active.promise === refreshPromise`), что исключает удаление in-flight записи более нового поколения завершившимся старым промисом.
5. **Изоляция withdrawal**: Callback отзыва проверяет `if (this.registrations.get(providerId) !== entry) return;`, поэтому отложенный unregister старого поколения не удаляет новую регистрацию, кеш или in-flight запрос.
6. **Инвалидация**: Очистка `invalidationTokens` происходит только если токен совпадает с `invalidationTokenAtStart`, сохраняя инвалидации, поступившие во время выполнения refresh.

## Working tree
До начала проверки рабочее дерево было чистым (чужие незакоммиченные изменения отсутствовали).

## Verdict
FAIL
