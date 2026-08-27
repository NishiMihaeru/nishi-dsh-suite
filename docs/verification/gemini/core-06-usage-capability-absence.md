# Core 06 — Usage capability absence validation

Tested commit: 72eef97a53550756eaf2eb39a1a9f6d08c36f593
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

## Contract
Провайдер, зарегистрированный в `NishiProvidersService`, для которого в дескрипторе отсутствует capability `usage` (`descriptor.usage === undefined`), является полноценным участником реестра и отображается в UI Usage & Limits:
- Включается в публичный roster (`getRosterPublic()`);
- Проецируется в честный `PublicProviderUsage` со статусом `status: 'UNSUPPORTED'`, `freshness: 'UNKNOWN'`, `windows: []`, `observedAtMs: clock()` и `displayName`, взятым из `presentation.displayName`;
- Отсутствие `usage` capability не интерпретируется как ошибка (`ERROR`), не вызывает сбоев и не требует создания искусственных (fake/synthetic) collector-объектов в `UsageLimitsService`;
- Полномочия и жизненный цикл провайдера остаются provider-agnostic.

## Host behavior
- **Roster (`getRosterPublic`)**: строится напрямую по `nishiProviders.all()`. Все зарегистрированные провайдеры (как с `usage`, так и без) возвращаются со своими presentation данными.
- **Cached list (`getCachedProvidersPublic`)**: возвращает снимки в порядке реестра (`registry order`). Для usage-less провайдеров генерируется честный DTO с `status: 'UNSUPPORTED'`. Для usage-capable провайдеров возвращается кэшированный снимок из `UsageLimitsPublicFacade` (если он есть). Если для usage-capable провайдера кэш ещё отсутствует, синтетический `UNSUPPORTED` не подставляется.
- **Get provider (`getCachedProviderPublic`)**: для зарегистрированного usage-less провайдера возвращает UNSUPPORTED DTO. Для неизвестного провайдера возвращает `undefined`.
- **Refresh (`refreshProviderPublic`)**: для usage-less провайдера немедленно возвращает UNSUPPORTED DTO без обращения к `UsageLimitsService`/коллекторам. Для неизвестного провайдера выбрасывает исключение `Provider "..." is not registered`.
- **Invalidation (`invalidateProvider`)**: для usage-less провайдера является безопасным no-op (не вызывает `UsageLimitsService.invalidate` для незарегистрированного id).
- **Withdrawal**: при дерегистрации usage-less провайдера он удаляется из реестра, исчезает из `getRosterPublic()` и `getCachedProvidersPublic()`.

## Browser behavior
- **Initialization**: клиентский контроллер выполняет `loadRoster()` -> `loadCached()` -> `ensureAllFresh()`. При наличии кэшированного UNSUPPORTED DTO строка сразу переходит в состояние `ready`.
- **Unsupported row**: отображает статус "Unsupported" / "Numeric usage data is not available for this provider." с корректным бейджем и логотипом провайдера, без ошибок.
- **Auto refresh**: метод `ensureFresh()` проверяет `existing?.status === 'UNSUPPORTED'` и пропускает фоновое обновление, предотвращая лишние RPC-вызовы при инициализации.
- **Manual refresh**: ручной вызов `refreshProvider(id)` остаётся разрешённым, проходит через общий RPC-канал и возвращает статус `ready` с `usage.status === 'UNSUPPORTED'`.

## RPC canonical identity
- RPC-слой (`createUsageLimitsRpcHandler`) использует единый канонический валидатор `canonicalProviderId` из `../registry/identity.js`.
- Silent trim полностью запрещён: идентификаторы с ведущими/замыкающими пробелами (например, `' codex '`) или пробелами внутри (например, `'codex route'`) отклоняются с кодом `bad-request` до обращения к методам хоста.
- Запросы с лишними полями полезной нагрузки отклоняются (`bad-request`).
- Внутренние ошибки хоста скрываются за generic internal response (`Usage limits operation failed.`), исключая утечку чувствительных данных.
- Поля `presentation` в `get-roster` проходят строгий whitelist.

## Mixed provider behavior
- Usage-capable и usage-less провайдеры корректно сосуществуют в одном реестре и в общем результате `getCachedProvidersPublic()`.
- Порядок вывода строго соответствует порядку регистрации в `NishiProvidersService`.
- Дублирование `providerId` исключено.
- Usage-capable провайдеры без кэша не превращаются ошибочно в `UNSUPPORTED`.

## Existing provider compatibility
- Провайдеры Codex, Antigravity и Claude сохраняют полную работоспособность, их тесты и изоляция проходят без регрессий (31 тест Codex, 7 тестов Antigravity, 146 тестов Core, 12 тестов Suite).

## Code review
1. Все зарегистрированные providers попадают в getRosterPublic(), независимо от наличия usage capability: **PASS**
2. Provider без usage capability остаётся зарегистрированным, присутствует в roster, isRegisteredProvider(id) === true: **PASS**
3. Provider без usage получает PublicProviderUsage (status=UNSUPPORTED, freshness=UNKNOWN, windows=[], displayName из presentation): **PASS**
4. Отсутствие usage capability НЕ превращается в ERROR: **PASS**
5. Для provider без usage не создаётся fake collector: **PASS**
6. UsageLimitsService регистрирует только providers с реальным usage collector: **PASS**
7. descriptor-level absence не загрязняет UsageLimitsService synthetic registrations: **PASS**
8. getCachedProviderPublic(id) для usage-less provider возвращает UNSUPPORTED DTO: **PASS**
9. getCachedProvidersPublic() включает usage-less providers в registry order: **PASS**
10. refreshProviderPublic(id) для usage-less provider возвращает UNSUPPORTED и не вызывает collector: **PASS**
11. refresh неизвестного provider по-прежнему является ошибкой и не производит synthetic row: **PASS**
12. invalidateProvider() для usage-less provider безопасен и не вызывает UsageLimitsService.invalidate(): **PASS**
13. При наличии usage capability старое поведение collector/cache/refresh не изменилось: **PASS**
14. Провайдер, чей collector сам возвращает UNSUPPORTED, работает через обычный collector path: **PASS**
15. Browser initialization (roster -> cached unsupported DTO -> ready state): **PASS**
16. Browser НЕ вызывает refreshProvider во время initialization для status UNSUPPORTED: **PASS**
17. Manual refresh unsupported provider разрешён и проходит через общий RPC path: **PASS**
18. buildUsageGroups / UI presentation поддерживают status UNSUPPORTED без provider-specific условий: **PASS**
19. Отсутствуют ветки вида `if providerId === codex / claude / antigravity`: **PASS**
20. Контракт полностью provider-agnostic: **PASS**
21. Не смонтированный провайдер не оставляет placeholder row: **PASS**
22. Late-mounted usage-less provider появляется после обновления roster: **PASS**
23. После withdrawal usage-less provider исчезает из roster: **PASS**
24. getCachedProvidersPublic не оставляет synthetic row после withdrawal: **PASS**
25. Usage RPC принимает канонический providerId `codex`: **PASS**
26. Usage RPC отклоняет ` codex ` как bad-request (silent trim запрещён): **PASS**
27. Provider id с пробелами внутри отклоняется: **PASS**
28. RPC использует те же правила `canonicalProviderId`, что и registry: **PASS**
29. Неканонический providerId отклоняется ДО вызова методов хоста: **PASS**
30. RPC скрывает внутренние ошибки generic internal response: **PASS**
31. Roster RPC применяет whitelist к presentation fields: **PASS**
32. `observedAtMs` в синтетическом DTO корректен, функциональных проблем нет: **PASS**
33. Порядок `getCachedProvidersPublic` соответствует registry roster order: **PASS**
34. Cached usage-capable и synthetic usage-less провайдеры сосуществуют без дубликатов: **PASS**
35. Usage-capable provider без кэша не становится ошибочно UNSUPPORTED: **PASS**
36. Синтетический UNSUPPORTED валидируется через `parsePublicProviderUsage`: **PASS**
37. Новые тесты проверяют результирующее состояние после операций: **PASS**
38. `isRegisteredProvider` через registry не открывает некорректных путей: **PASS**
39. Семантика `getCachedProvidersPublic` не ломает существующих вызовов: **PASS**
40. Поведение Codex / Antigravity / Claude не регрессировало: **PASS**

Комментарии в дескрипторах и документация приведены в полное соответствие с кодом ("Absent usage means UI shows an honest row, never an error.").

NO BLOCKING ISSUES FOUND.

## Working tree
Состояние до проверки: чистый рабочий каталог на ветке `feat/core-provider-plugins-rc3` (HEAD: `72eef97a53550756eaf2eb39a1a9f6d08c36f593`).

## Verdict

PASS
