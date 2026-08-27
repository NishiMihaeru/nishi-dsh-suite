# Core 03 — Provider identity validation

Tested commit: 69c817f25d428845288654cb0222943c66e8eb96
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

## Identity contract
В модуле [packages/core/src/registry/identity.ts](file:///home/acedia/Проекты/nishi-dsh-suite/packages/core/src/registry/identity.ts) реализован единый контракт канонической валидации для `provider id` и model `routes` через функцию `canonicalIdentity`:
1. **Тип и непустота**: значение обязано быть строкой `typeof value === 'string'` ненулевой длины (`value.length > 0`). Пустые строки или другие типы вызывают исключение.
2. **Отсутствие leading/trailing пробелов**: `value === value.trim()`. Строки с начальными или конечными пробелами отклоняются с ошибкой (любой silent trim исключён).
3. **Отсутствие whitespace внутри**: регулярное выражение `/\s/u` запрещает любые пробельные символы внутри идентификатора или маршрута.
4. **Отсутствие управляющих символов**: регулярное выражение `/[\u0000-\u001f\u007f]/u` запрещает любые control characters.
5. **Ограничение длины**:
   - `canonicalProviderId`: длина ограничена `MAX_PROVIDER_ID_LENGTH = 64`.
   - `canonicalProviderRoute`: длина ограничена `MAX_PROVIDER_ROUTE_LENGTH = 128`.
6. **Уникальность маршрутов**:
   - Внутри одного дескриптора дубликаты маршрутов отслеживаются через `Set<string>` и отклоняются.
   - Между различными провайдерами коллизии маршрутов отклоняются на уровне реестра в `NishiProvidersService.record`.
7. **Связь дескриптора и презентации**: `descriptor.presentation.id` валидируется как канонический идентификатор и обязан строго совпадать с `descriptor.id`.
8. **Требование маршрутов при наличии model capability**: дескриптор с объявленным `model` обязан иметь хотя бы один маршрут (`routes.length > 0`). Дескрипторы без `model` (например, usage-only провайдер Claude) валидны с `routes: []`.
9. **Строгое соответствие ключей реестра**: методы реестра `byId(id)` и `byRoute(route)` больше не выполняют неявный `.trim()`, выполняя точный поиск по каноническому ключу Map без расхождения между ключом и содержимым `RegisteredProvider`.

## Regression coverage
Тесты в [packages/core/test/registry.test.ts](file:///home/acedia/Проекты/nishi-dsh-suite/packages/core/test/registry.test.ts) и [packages/core/test/registration.test.ts](file:///home/acedia/Проекты/nishi-dsh-suite/packages/core/test/registration.test.ts) покрывают все сценарии некорректных и неканонических идентификаторов:
- `an empty id is refused`: попытка передать пустую строку `""` отклоняется с ошибкой `must be a non-empty string`.
- `provider ids must already be canonical and are never silently trimmed`: отклонение id с внешними пробелами (`" fixture "`) и внутренними пробелами (`"fixture id"`), а также проверка, что поиск по ненормализованному ключу возвращает `undefined` и реестр остаётся чистым.
- `provider routes must already be canonical and are never silently trimmed`: отклонение route с внешними (`" route "`) и внутренними (`"route with space"`) пробелами, поиск возвращает `undefined`.
- `provider identity bounds are enforced at the registry boundary`: проверка превышения лимитов `MAX_PROVIDER_ID_LENGTH + 1` (65 символов) и `MAX_PROVIDER_ROUTE_LENGTH + 1` (129 символов).
- `duplicate routes inside one provider are refused before state changes`: дублирование маршрутов внутри дескриптора отклоняется до внесения записей в реестр.
- `a duplicate route is refused, naming the provider that already owns it`: попытка второго провайдера зарегистрировать уже занятый маршрут отклоняется с указанием владельца, состояние второго провайдера в реестре не сохраняется.
- `a usage-only provider declaring no route is registered and serves none`: провайдер без маршрутов (`routes: []`) корректно регистрируется и разрешается по id.
- `registerProvider refuses a presentation whose id disagrees with the provider id`: несовпадение `presentation.id` и `descriptor.id` отклоняется до регистрации.
- `registerProvider refuses a model capability with no route`: наличие `model` с пустым массивом `routes: []` отклоняется.
- `registerProvider rejects a noncanonical provider id before capability factories run`: подтверждение отсутствия side effects (вызовов `model.create`, `webSearch.create`, `usage.create`, `install`, `registry.record`) при некорректном `id`.
- `registerProvider rejects a noncanonical model route before capability factories run`: подтверждение отсутствия side effects при некорректном route.
- `registerProvider rejects duplicate model routes before capability factories run`: подтверждение отсутствия side effects при дублировании маршрутов.

## Side-effect ordering
Подтверждено: в [packages/core/src/runtime/registration.ts](file:///home/acedia/Проекты/nishi-dsh-suite/packages/core/src/runtime/registration.ts) валидация идентичностей выполняется в самом начале функции `registerProvider`:
1. Валидация `providerId = canonicalProviderId(descriptor.id)`.
2. Проверка наличия сервиса `ctx.nishiProviders`.
3. Валидация `presentationId = canonicalProviderId(descriptor.presentation.id)` и проверка равенства `presentationId === providerId`.
4. Итерация по `descriptor.model?.routes` с валидацией каждого маршрута через `canonicalProviderRoute` и проверкой на дубликаты в дескрипторе.
5. Проверка непустоты маршрутов для model capability (`descriptor.model && routes.length === 0`).

Фабрики capabilities (`descriptor.webSearch?.create`, `descriptor.usage?.create`), регистрация в реестре (`registry.record`), регистрация адаптера (`ctx.llm.registerAdapter`) и `descriptor.install` вызываются строго после успешного завершения всех проверок валидности. Если дескриптор неканоничен, генерируется исключение до инициализации каких-либо подпроцессов, адаптеров или мутации состояния реестра.

## Code review
Результаты проверки 20 инвариантов:

1. **Provider id не может быть пустым**: Выполняется (`canonicalIdentity` проверяет тип и длину > 0).
2. **Provider id с leading/trailing whitespace отклоняется, а не trim'ится**: Выполняется (`value !== value.trim()`).
3. **Provider id с whitespace внутри отклоняется**: Выполняется (`/\s/u.test(value)`).
4. **Provider id ограничен MAX_PROVIDER_ID_LENGTH (64)**: Выполняется (`value.length > maxLength`).
5. **Route не может быть пустым**: Выполняется (`canonicalIdentity` проверяет тип и длину > 0).
6. **Route с leading/trailing whitespace отклоняется**: Выполняется (`value !== value.trim()`).
7. **Route с whitespace внутри отклоняется**: Выполняется (`/\s/u.test(value)`).
8. **Route ограничен MAX_PROVIDER_ROUTE_LENGTH (128)**: Выполняется (`value.length > maxLength`).
9. **Duplicate route внутри одного provider descriptor отклоняется**: Выполняется (проверка через `Set<string>` в `registerProvider` и `service.ts`).
10. **Duplicate route между двумя providers по-прежнему отклоняется**: Выполняется (проверка `this.#byRoute.get(route)` в `service.ts`).
11. **Registry не хранит один string как Map key и другой string внутри RegisteredProvider**: Выполняется (ключи в `Map` и поля объекта совпадают, так как `canonicalIdentity` возвращает исходную проверенную строку без мутаций).
12. **byId() и byRoute() больше не скрывают ошибку вызывающего кода автоматическим trim**: Выполняется (вызовы `.trim()` удалены из методов поиска).
13. **Usage-only provider с model capability отсутствующим и routes=[] по-прежнему допустим на registry layer**: Выполняется (`routes: []` разрешён и поддерживается).
14. **Provider с model capability и routes=[] отклоняется registerProvider()**: Выполняется (`if (descriptor.model && routes.length === 0)` бросает ошибку).
15. **presentation.id обязан совпадать с descriptor.id**: Выполняется (проверка `presentationId !== providerId`).
16. **Неканонический descriptor отклоняется до вызова capability factories и registry.record**: Выполняется (все проверки предшествуют созданию экземпляров и регистрации).
17. **Новые validators не содержат provider-specific naming или hardcoded provider list**: Выполняется (валидаторы универсальны, оперируют только синтаксическими ограничениями строк).
18. **Правила не запрещают будущему provider использовать нормальные vendor route aliases с символами вроде `-`, `_` или `.`**: Выполняется (запрещены только пробелы и control characters, любые другие символы разрешены).
19. **Нет очевидного API regression для существующих Codex, Antigravity и Claude descriptors**: Выполняется (все дескрипторы и интеграционные тесты проходят проверку).
20. **Ошибочный descriptor не оставляет частичной registry state**: Выполняется (валидация всех маршрутов и коллизий в `record()` происходит до вызовов `this.#byId.set` и `this.#byRoute.set`).

### Архитектурный анализ
- Единый хелпер `packages/core/src/registry/identity.ts` централизует правила валидации идентификаторов и константы лимитов длины.
- `NishiProvidersService.record` обеспечивает defense-in-depth на границе реестра, повторно валидируя контракт идентичности независимо от вызывающей стороны.
- Правила валидации в `registerProvider` и `NishiProvidersService` полностью согласованы и используют одни и те же функции.
- Исключён любой риск рассинхронизации ключей Map и свойств зарегистрированных объектов.

NO BLOCKING ISSUES FOUND.

## Working tree
Состояние до проверки: чистый working tree (`git status --short` пуст), ветка `feat/core-provider-plugins-rc3`, HEAD на коммите `69c817f25d428845288654cb0222943c66e8eb96`. Посторонние изменения отсутствуют.

## Verdict
PASS
