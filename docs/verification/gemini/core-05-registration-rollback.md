# Core 05 — Provider registration rollback validation

Tested commit: 5d18213dea0020a1b384913a9a1a32cd9dd688d9
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: pnpm --filter nishi-dsh-core test
Exit code: 0
Result: PASS

### check
Command: pnpm --filter nishi-dsh-core check
Exit code: 0
Result: PASS

### build
Command: pnpm --filter nishi-dsh-core build
Exit code: 0
Result: PASS

## Real API validation

Семантика и поведение сверены непосредственно с установленными пакетами `@deepseek-ai/cordis@4.0.1` и `@deepseek-ai/dsh-llm@0.1.1-rc.2` в `node_modules`:

1. **`ctx.effect` disposer**:
   - `ctx.effect(execute)` возвращает функцию-обертку (`wrapper`), управляющую жизненным циклом эффекта.
   - Ручной вызов `dispose()` переводит раннер в `runner.epoch = false`, выполняет teardown-функцию и возвращает задачу освобождения (`disposalTask`, при асинхронном teardown — `Promise<void>`).
   - Повторный вызов идемпотентен и безопасен: при неактивной эпохе (`!runner.epoch`) вызов возвращает `inFlight` / `undefined` без повторного исполнения teardown.
   - При последующей выгрузке файбера Cordis обходит `_disposables`, видит `runner.epoch === false` и не дублирует вызов.
   - `await disposeRegistryEffect()` корректно дожидается завершения асинхронного снятия эффекта.

2. **`ctx.llm.registerAdapter` disposer**:
   - В DSH LLM (`@deepseek-ai/dsh-llm` 0.1.1-rc.2) метод `registerAdapter(providers, adapter)` регистрирует генераторный эффект через `this.ctx.effect(...)` и возвращает callable `handle = (() => void dispose())`.
   - Вызов `disposeAdapter()` удаляет зарегистрированные маршруты из `this.adapters`, очищает внутренний `Set` `owned` и эмитит событие обновления.
   - Повторный вызов безопасен и идемпотентен (множество `owned` уже пусто, повторное удаление ключей из `Map` — no-op).
   - Ручной вызов диспоузера не конфликтует с дальнейшей штатной выгрузкой файбера Cordis.

3. **Provider fiber cleanup после rejected apply**:
   - Если функция `apply()` плагина провайдера завершается с ошибкой (rejection из `registerProvider`), Cordis переводит файбер в состояние `INACTIVE` (`state = 5`) и запускает `fiber._unload()`.
   - В ходе `_unload()` Cordis выполняет и очищает все зарегистрированные на файбере диспоузеры (`this._disposables.clear()`), гарантируя снятие любых fiber-owned ресурсов.

## Failure matrix

| Точка отказа | Что успело зарегистрироваться | Что снимает rollback | Что остаётся после rejection |
|---|---|---|---|
| **1. Валидация дескриптора** (невалидный `id`, несовпадение `presentation.id`, пустые/дублирующиеся маршруты) | Ничего | Rollback не требуется (мутации ядра не начинались) | Чисто: 0 записей в реестре, 0 адаптеров LLM |
| **2. `webSearch.create()` failure** | Ничего | Rollback не требуется (фабрика вызывается до мутаций ядра) | Чисто: 0 записей в реестре, 0 адаптеров LLM |
| **3. `usage.create()` failure** (после успешного `webSearch.create()`) | Ничего | Rollback не требуется (`registry.record` еще не вызывался) | Чисто: 0 записей в реестре, 0 адаптеров LLM |
| **4. `registry.record()` failure** | Ничего (`record` выбросил ошибку до сохранения) | `disposeAdapter` и `disposeRegistryEffect` undefined — пропуск | Чисто: 0 записей в реестре, 0 адаптеров LLM |
| **5. `ctx.effect()` failure** (после `registry.record()`) | Запись в `nishiProviders` | `disposeRegistryEffect` undefined; срабатывает ветка `else if (forgetRegistry !== undefined)` с прямым вызовом `forgetRegistry()` | Чисто: запись в реестре полностью снята |
| **6. `model.create()` failure** (после записи в реестр) | Запись в `nishiProviders` + зарегистрирован `ctx.effect` | `disposeAdapter` undefined; `await disposeRegistryEffect()` снимает запись из реестра | Чисто: 0 записей в реестре, 0 адаптеров LLM |
| **7. `ctx.llm.registerAdapter()` failure** | Запись в `nishiProviders` + зарегистрирован `ctx.effect` | `disposeAdapter` undefined; `await disposeRegistryEffect()` снимает запись из реестра | Чисто: 0 записей в реестре, 0 адаптеров LLM, `install` не вызывается |
| **8. Синхронный `install()` throw** | Запись в `nishiProviders`, `ctx.effect`, адаптер в `ctx.llm` | 1. `disposeAdapter()` снимает маршруты LLM; 2. `await disposeRegistryEffect()` снимает запись из реестра | Чисто: 0 записей в реестре, 0 адаптеров LLM |
| **9. Асинхронный `install()` rejection** | Запись в `nishiProviders`, `ctx.effect`, адаптер в `ctx.llm` | 1. `disposeAdapter()` снимает маршруты LLM; 2. `await disposeRegistryEffect()` снимает запись из реестра | Чисто: rejection не покидает `registerProvider` до завершения rollback |
| **10. Штатная регистрация (Success)** | Запись в `nishiProviders`, `ctx.effect`, адаптер в `ctx.llm` | Rollback не вызывается | Все ресурсы активны; при выгрузке файбера Cordis снимает адаптер и реестр в LIFO-порядке |

## Rollback ordering

Подтвержден строгий LIFO-порядок отката:
1. **Первым** вызывается `disposeAdapter()` (если адаптер был зарегистрирован), освобождая маршруты модели в `ctx.llm`.
2. **Вторым** вызывается `await disposeRegistryEffect()` (или `forgetRegistry()`), снимая провайдера и его маршруты из реестра `nishiProviders`.

Порядок отката строго противоположен порядку регистрации (`registry.record` -> `ctx.effect` -> `registerAdapter` -> `install`).

## Rollback failure handling

Функция `rollbackRegistration`:
- Оборачивает вызов `disposeAdapter()` в `try / catch`: если диспоузер адаптера выбрасывает исключение, ошибка добавляется в массив `rollbackErrors`, а выполнение переходит к очистке реестра.
- Очистка реестра (`disposeRegistryEffect()` или `forgetRegistry()`) также обернута в `try / catch`: если она выбрасывает ошибку, та сохраняется в `rollbackErrors`.
- Если массив `rollbackErrors` не пуст, выбрасывается `AggregateError([originalError, ...rollbackErrors], ...)` со ссылкой на `{ cause: originalError }`.
- Исходная ошибка никогда не маскируется и не теряется.

## Provider compatibility

1. **Codex**:
   - `model.create` конструирует `CodexAppServerAdapter` и передает в ядро;
   - `install` запускает `installCodexPrimaryHistoryBridge(ctx)`, ожидая уже зарегистрированный адаптер;
   - Новый порядок `registerProvider` полностью сохраняет эту последовательность и семантику.
2. **Antigravity**:
   - `model.create` создает `AntigravityCliAdapter`;
   - Хук `install` отсутствует;
   - Регистрация и откат работают штатно.
3. **Claude**:
   - Usage-only провайдер без `model` и без `install`;
   - `descriptor.model` отсутствует, `routes` равен `[]`, `registerAdapter` не вызывается;
   - `registerProvider` завершается успешно, а логика отката корректно обрабатывает `disposeAdapter === undefined`.
4. **Провайдер без model и без install**:
   - Подтверждена успешная регистрация и корректный жизненный цикл.

## Fiber-owned effects

**Граница ответственности**:
- **Core-owned state**: Реестр `nishiProviders` и маршруты LLM-адаптера в `ctx.llm`. Core гарантирует их синхронный/транзакционный откат внутри `registerProvider` до возврата управления или проброса ошибки.
- **Provider fiber-owned state**: Любые эффекты, слушатели или сервисы, которые фабрики провайдера или хук `install` регистрируют на файбере контекста провайдера (`ctx.effect`, `ctx.on`). При штатном пробросе ошибки из `registerProvider` в `apply` плагина, Cordis переводит файбер в состояние `INACTIVE` и автоматически выполняет `fiber._unload()`, очищая все fiber-owned эффекты.

*Ограничение (Limitation)*: Если плагин провайдера в своей функции `apply` перехватит rejection `registerProvider` и подавит его (не пробросит дальше наружу), Cordis посчитает плагин успешно загруженным и не выгрузит файбер. Контракт плагинов провайдеров требует обязательного проброса ошибок из `registerProvider`.

## Tests review

Набор тестов `packages/core/test/registration-rollback.test.ts`:
- Проверяет не только факт выброса исключения (`assert.rejects`), но и реальное состояние после сбоя через `assertNoCoreState(fixture)`, подтверждая, что в `activeProviders` и `activeAdapters` не остается записей.
- Проверяет точную последовательность событий вызовов и очистки (`fixture.events`).
- Проверяет агрегацию ошибок (`AggregateError`) при сбоях внутри самих диспоузеров отката.

## Working tree

Состояние до проверки: чистый рабочий каталог на коммите `5d18213dea0020a1b384913a9a1a32cd9dd688d9` ветки `feat/core-provider-plugins-rc3`.

## Verdict

PASS
