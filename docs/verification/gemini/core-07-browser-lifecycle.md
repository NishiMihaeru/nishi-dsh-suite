# Core 07 — Browser lifecycle validation

Tested commit: 027a72c175b641bfdb4143336c5de0f5f7e3693b
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

## Generation model
В `UsageLimitsClientController` внедрена модель топологических поколений (`rosterGeneration: number`), защищающая состояние клиентского контроллера от гонок асинхронных операций при изменении состава или перезапуске провайдеров на хосте:
- `rosterGeneration` инициализируется нулём при создании экземпляра контроллера.
- `rosterGeneration` инкрементируется (`this.rosterGeneration++`) при каждом успешно принятом и применённом ответе хоста на `getRoster()`.
- Инкремент поколения выполняется безусловно при получении валидного ответа ростера, даже если набор идентификаторов `providerId` визуально не изменился. Это обеспечивает корректную изоляцию в сценариях выгрузки и повторной регистрации провайдера (unload / re-register) с тем же каноническим идентификатором между двумя опросами ростера браузером.
- Каждая асинхронная операция обновления (`doRefresh`) и загрузки кэшированных данных (`loadCached`) захватывает текущее значение `rosterGeneration` в локальную константу `generation` в точке старта.
- По завершении асинхронной работы контроллер проверяет соответствие захваченного поколения текущему через предикат `hasProvider(providerId, generation)` или явное сравнение `generation === this.rosterGeneration`.
- Если поколение изменилось (или провайдер был удалён из ростера), операция признаётся устаревшей (`stale`): результаты RPC отбрасываются, снимок состояния (`snapshot`) не модифицируется, и подписчики не получают ложных уведомлений (`notify()`).

## Refresh lifecycle
Жизненный цикл операции обновления usage-данных провайдера (`doRefresh`):
- **Захват поколения и валидация наличия**: операция захватывает `const generation = this.rosterGeneration` и проверяет `if (!this.hasProvider(providerId, generation)) return`. Если провайдер отсутствует в текущем ростере (или поколение устарело), вызов немедленно прерывается без создания фантомных записей в `snapshot.providers`.
- **Дедупликация in-flight запросов**: перед запуском нового сетевого запроса проверяется `active = this.inFlightRefreshes.get(providerId)`.
  - Если активная запись принадлежит текущему поколению (`active?.generation === generation`), контроллер присоединяется к существующему `Promise` (`await active.promise.catch(() => {})`) без создания повторного RPC-запроса к хосту.
  - Если активная запись принадлежит предыдущему (устаревшему) поколению (`active.generation !== generation`), контроллер не присоединяется к ней, а запускает независимый запрос под новым поколением.
- **Identity guard в блоке finally**:
  - Для отслеживания in-flight операций используется структура `InFlightRefresh { generation: number, promise: Promise<PublicProviderUsage> }`.
  - Дескриптор `record = { generation, promise }` сохраняется в `inFlightRefreshes.set(providerId, record)`.
  - В блоке `finally` промиса выполняется проверка идентичности объекта: `if (this.inFlightRefreshes.get(providerId) === record) { this.inFlightRefreshes.delete(providerId) }`.
  - Благодаря проверке по ссылке (`=== record`), завершение устаревшего промиса из предыдущего поколения не может удалить активный дескриптор нового поколения, зарегистрированный для того же `providerId`.
  - После завершения актуального запроса дескриптор штатно удаляется из таблицы `inFlightRefreshes`.
- **Изоляция успеха и ошибок stale refresh**:
  - Успешный ответ устаревшего `refresh` не может восстановить удалённого провайдера, перезаписать данные нового провайдера с тем же ID или обновить `lastRefreshedAtMs` нового поколения.
  - Ошибка устаревшего `refresh` не может перевести строку нового поколения в статус `error` или удалить существующую запись.
  - При ошибке актуального поколения контроллер выставляет статус `error` с сохранением ранее полученного `usage` (`prior?.usage`) и стандартным сообщением `errorMessage: 'Usage data is unavailable.'`.

## Roster concurrency
Для предотвращения применения устаревших ответов ростера при конкурентных сетевых запросах используется механизм монотонных номеров запросов (`rosterRequestSerial: number`):
- Каждый вызов `loadRoster()` инкрементирует `rosterRequestSerial` (`const requestSerial = ++this.rosterRequestSerial`).
- При получении ответа от хоста выполняется проверка `if (requestSerial !== this.rosterRequestSerial) return`. Если за время выполнения текущего запроса был запущен более новый, ответ текущего запроса полностью игнорируется.
- Это гарантирует семантику *latest-request-wins* даже при нарушении порядка доставки сетевых ответов (out-of-order responses), исключая перезапись нового ростера более старым.
- В случае ошибки последнего запроса (`requestSerial === this.rosterRequestSerial`) сохраняется последнее известное валидное состояние (*last-known-good roster*), предотвращая необоснованное очищение UI при временных сетевых сбоях.
- Если ростер был пуст изначально (initial failure), состояние остаётся пустым.

## Cached lifecycle
Загрузка кэшированных данных (`loadCached()`):
- Метод захватывает `const generation = this.rosterGeneration` до отправки RPC-запроса `getProviders()`.
- При получении ответа выполняется проверка `if (generation !== this.rosterGeneration) return`. Если топология ростера изменилась во время ожидания ответа, весь кэшированный ответ отбрасывается.
- При совпадении поколений применяется дополнительный фильтр по текущему ростеру: `const rosterIds = new Set(this.snapshot.roster.map((entry) => entry.providerId))`. Данные применяются только для тех провайдеров, которые присутствуют в текущем ростере (`if (!rosterIds.has(item.providerId)) continue`).
- Это исключает возможность воскрешения удалённых провайдеров или появления строк, отсутствующих в текущем реестре хоста.
- Сохранена корректная обработка провайдеров со статусом `UNSUPPORTED` (Core 06), которые загружаются через кэшированный путь и переходят в статус `ready` без вызова фонового refresh.
- Поведение для usage-capable провайдеров не регрессировало.

## Regression scenarios
Все четыре регрессионных теста в `packages/core/test/client-lifecycle.test.ts` полностью покрывают ключевые гонки жизненного цикла:

1. **`a refresh from an older roster generation cannot resurrect a removed provider`**:
   - Провайдер `fixture` запускает `refreshProvider` в поколении 1.
   - Ростер очищается (`roster = []`), `loadRoster()` переводит контроллер в поколение 2.
   - Устаревший промис успешно завершается данными usage.
   - Проверка подтверждает: `snapshot.roster` и `snapshot.providers` остаются пустыми, удалённый провайдер не воскрешён.

2. **`a newer roster generation starts its own refresh and an old finally cannot delete it`**:
   - В поколении 1 запускается `refreshProvider('fixture')` (первый RPC-вызов).
   - Выполняется `loadRoster()`, инициируя поколение 2 с тем же `fixture`.
   - Запускается новый `refreshProvider('fixture')` (второй RPC-вызов).
   - Старый refresh завершается; его `finally` проверяет идентичность `record` и не удаляет запись нового поколения из `inFlightRefreshes`.
   - Третий вызов `refreshProvider('fixture')` успешно дедуплицируется и присоединяется к in-flight запросу поколения 2 (счётчик RPC-вызовов остаётся равен 2).
   - После завершения обоих промисов snapshot содержит данные именно от второго обновления (`observedAtMs: 2_000`).

3. **`an older roster response cannot overwrite a newer roster response`**:
   - Конкурентно запускаются два запроса `loadRoster()`: `older` (serial 1) и `newer` (serial 2).
   - Запрос `newer` завершается первым с ростером `['new']`.
   - Запрос `older` завершается позже с ростером `['old']`.
   - Проверка подтверждает: контроллер сохраняет ростер `['new']`, устаревший ответ serial 1 отброшен.

4. **`a cached response from an older roster generation cannot recreate a removed provider`**:
   - Контроллер загружает ростер с `fixture` (поколение 1) и запускает `loadCached()`.
   - Ростер очищается, `loadRoster()` переводит контроллер в поколение 2.
   - Завершается ответ `loadCached()` с данными для `fixture`.
   - Проверка подтверждает: состояние остаётся пустым, устаревший кэшированный ответ не восстанавливает запись.

## Existing behavior
- **`initialize()`**: сохраняет последовательность `loadRoster()` -> `loadCached()` -> `ensureAllFresh()` -> `phase: 'ready'`. Дедупликация через `initializePromise` и очистка в `finally` функционируют штатно.
- **`refreshAll()`**: сначала выполняет `loadRoster()`, продвигая поколение топологии и инвалидируя устаревшие in-flight операции, затем выполняет `refreshProvider` для каждого провайдера из актуального ростера.
- **`ensureFresh()`**: пропускает фоновое обновление для провайдеров со статусом `UNSUPPORTED` или `freshness: 'FRESH'`.
- **Failure semantics**: ошибка актуального refresh устанавливает статус `error` с сохранением предыдущего `usage`, а ошибка stale refresh не искажает состояние нового поколения.
- **Architecture**:
  - Контроллер остаётся строго provider-agnostic, без жестко закодированных вендорных идентификаторов (`codex`, `claude`, `antigravity`).
  - Поколение является атрибутом общей топологии реестра хоста.
  - Отсутствуют утечки памяти: `inFlightRefreshes` своевременно очищается при завершении как актуальных, так и устаревших запросов; промисы не вызывают `unhandled rejection`.
  - Уведомления подписчиков (`notify()`) вызываются только при валидных изменениях актуального поколения.

## Additional race review
Проведён детальный анализ потенциальных граничных условий и гонок конкурентности:
1. `loadRoster` во время `refresh`: изолирован generation guard.
2. Два конкурентных `loadRoster`: изолированы сериализацией `rosterRequestSerial` (latest-request-wins).
3. `loadCached` во время `loadRoster`: изолирован generation guard и фильтром `rosterIds`.
4. `refreshAll` во время `initialize`: безопасен благодаря смене поколения при `loadRoster`.
5. Ручной `refresh` во время `refreshAll`: дедуплицируется в рамках одного поколения и изолируется при смене поколения.
6. Провайдер удалён и пересоздан с тем же ID: защищён монотонным инкрементом `rosterGeneration`.
7. Завершение или сбой refresh после удаления провайдера: безопасно отбрасывается через `hasProvider()`.
8. Выполнение устаревшего `finally` после старта нового запроса: защищено сравнением идентичности объекта `record`.

NO BLOCKING ISSUES FOUND.

## Working tree
Состояние до проверки: чистый рабочий каталог на ветке `feat/core-provider-plugins-rc3` (HEAD: `027a72c175b641bfdb4143336c5de0f5f7e3693b`).

## Verdict

PASS
