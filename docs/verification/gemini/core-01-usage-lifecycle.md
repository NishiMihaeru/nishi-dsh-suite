# Core 01 — Usage lifecycle validation

Tested commit: 1237bc360c4b3bd198eb84ccd966c4fbab60a1fe
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 0
Result: PASS

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

## Regression scenario
Подтверждено. Тест `packages/core/test/usage-lifecycle.test.ts` полностью доказывает все ключевые инварианты жизненного цикла провайдеров:
- **stale generation не пишет cache**: при попытке устаревшего сбора данных завершиться после смены поколения в `refreshPromise` срабатывает guard `if (this.registrations.get(providerId) !== reg)`, вызывающий исключение `UsageContractError: Provider "fixture" registration changed during refresh` и блокирующий запись в кеш.
- **stale finally не удаляет новый in-flight**: проверка `active?.registration === reg && active.promise === refreshPromise` в `finally` блоке гарантирует, что завершение устаревшего промиса не очищает активный in-flight промис нового поколения.
- **concurrent refresh нового поколения дедуплицируется**: вызов `secondJoin` для нового поколения (с `force: true`) обнаруживает совпадение `existingInFlight?.registration === reg` и переиспользует существующий промис без повторного запуска `collector.collect()`.
- **withdrawal старого поколения не затрагивает новое**: guard `if (this.registrations.get(providerId) !== entry) return;` в callback'е отзыва предотвращает удаление новой регистрации, кеша и in-flight состояния при вызове `withdraw()` для старого поколения.

## Code review
NO BLOCKING ISSUES FOUND.

Реализация generation guard в `UsageLimitsService` (`packages/core/src/usage/service.ts`) полностью изолирует жизненный цикл сменяющихся регистраций:
1. Каждая регистрация получает уникальную объектную идентичность `entry`, выступающую токеном поколения.
2. `InFlightRefresh` связывает `promise` со ссылкой на `registration`, что предотвращает коллизии между поколениями при дедупликации.
3. Очистка `inFlight` в `finally` строго проверяет идентичность как поколения `reg`, так и самого промиса `refreshPromise`.
4. Запись снапшота в кеш и очистка токена инвалидации защищены проверкой актуальности поколения.
5. Callback отзыва безопасен при повторных или запоздалых вызовах.

## Working tree
Рабочее дерево до проверки было чистым (`git status --short` пуст, HEAD на коммите `68c54f4a95e61b06b4ffbea8cd982a6ad87ccd85`). Посторонние локальные изменения отсутствовали.

## Verdict
PASS
