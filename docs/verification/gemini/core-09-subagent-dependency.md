# Core 09 — Subagent dependency removal

Tested commit: 704ce393d9cd09888876485c612392b9976ec8d3
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Lockfile
Выполнена детерминированная регенерация через `pnpm install --lockfile-only`.
В `pnpm-lock.yaml` обновлён исключительно importer `packages/core`:
- Удалена прямая devDependency `@deepseek-ai/dsh-subagent` (3 строки удалены).
- Посторонних изменений версий или транзитивных резолюций других пакетов не произошло.

Lockfile commit: 704ce393d9cd09888876485c612392b9976ec8d3

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 0
Result: PASS

Все 158 тестов пакета `nishi-dsh-core` завершились успешно (включая регрессионные тесты в `packages/core/test/package-boundary.test.ts` и тесты валидации конфигурации в `packages/core/test/registration.test.ts`).

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

Typecheck `tsc -p tsconfig.json --noEmit` прошёл без ошибок.

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

Сборка через `tsdown` завершилась успешно.

## Dependency boundary
1. **Манифест (`packages/core/package.json`)**:
   - Пакет `@deepseek-ai/dsh-subagent` полностью удалён из секций `dependencies`, `peerDependencies` и `devDependencies`.
   - В `dsh.client.inject` отсутствуют ссылки на subagent-сервисы.
2. **Исходный код (`packages/core/src`)**:
   - В `packages/core/src` нет ни одного импорта из `@deepseek-ai/dsh-subagent`.
   - Единственное упоминание слова `subagent` находится в историческом doc-комментарии `packages/core/src/runtime/registration.ts`, поясняющем удаление шага delegation в `0.1.0-rc.3`.
3. **Lockfile importer**:
   - Importer `packages/core` в `pnpm-lock.yaml` больше не запрашивает `@deepseek-ai/dsh-subagent`.
4. **Регрессионные тесты (`packages/core/test/package-boundary.test.ts`)**:
   - Проверяют и подтверждают отсутствие `@deepseek-ai/dsh-subagent` во всех секциях зависимостей `package.json`.
   - Проверяют и подтверждают отсутствие импорта `@deepseek-ai/dsh-subagent` в `src/runtime/registration.ts`.
5. **Поиск по репозиторию**:
   - `rg -n "@deepseek-ai/dsh-subagent" packages/core --glob '!lib/**' --glob '!node_modules/**'` находит строку исключительно в виде константы `SUBAGENT_PACKAGE` в файле теста границы пакета `package-boundary.test.ts`.

## Config behavior parity
Локальная реализация `assertPositiveFinite` в `packages/core/src/runtime/registration.ts`:
```ts
function assertPositiveFinite(id: string, field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${id}: ${field} must be a positive finite number`)
  }
}
```
Полностью сохраняет исходный контракт и поведение:
- **Контракт**: значение должно быть числом (`typeof value === 'number'`), конечным (`Number.isFinite(value)`) и строго положительным (`value > 0`).
- **Формат сообщений об ошибках**: при нарушении бросается `Error` с точным сообщением `${id}: ${field} must be a positive finite number`.
- **Семантика полей в `resolveSharedProviderConfig`**:
  - `catalogTimeoutMs`, `turnTimeoutMs`, `disposeGraceMs`, `stderrMaxBytes`: отклоняют `0`, `NaN`, `Infinity`, отрицательные числа; принимают положительные конечные числа.
  - Поля таймеров (`catalogTimeoutMs`, `turnTimeoutMs`, `disposeGraceMs`): валидируются на ограничение `<= MAX_TIMER_DELAY_MS` (`MAX_TIMER_DELAY_MS` принимается, `MAX_TIMER_DELAY_MS + 1` отклоняется с сообщением `${id}: ${field} must be no greater than ${MAX_TIMER_DELAY_MS}`).
  - `stderrMaxBytes`: не ограничен `MAX_TIMER_DELAY_MS`.
  - `modelCacheMs`: проверяется отдельно, значение `0` является валидным (кэширование отключено), отрицательные и нефинитные значения отклоняются с сообщением `${id}: modelCacheMs must be non-negative and finite`.
  - `env`: передаётся без модификаций.

## Build output
- В артефактах сборки `packages/core/lib` отсутствуют какие-либо runtime import'ы `@deepseek-ai/dsh-subagent`.
- `assertPositiveFinite` скомпилирован как внутренняя вспомогательная функция внутри `lib/runtime.js` и не экспортируется в `lib/runtime.d.ts` (публичный API `nishi-dsh-core/runtime` остался неизменным).
- Проверка `rg -n "@deepseek-ai/dsh-subagent|assertPositiveFinite" packages/core/lib` возвращает только внутреннее объявление и вызовы `assertPositiveFinite` в `lib/runtime.js`.

## Additional review
- `assertPositiveFinite` является чистой утилитарной функцией, не зависит от провайдера (`provider identity`) и не содержит специфичной логики вендоров (Codex/Antigravity/Claude).
- Удаление `peerDependencies` не нарушает host-контракт: ядро не регистрирует и не обращается к `ctx.subagents`.
- Попытки найти другие прямые runtime/code зависимости `nishi-dsh-core` от `dsh-subagent` показали их полное отсутствие.
- NO BLOCKING ISSUES FOUND.

## Working tree
- До начала проверки: чистое дерево на ветке `feat/core-provider-plugins-rc3` (fast-forward pull до `e54934a`).
- Коммит lockfile: `704ce39` (`chore: refresh lockfile after core dependency cleanup`).
- После проверки: зафиксирован отчёт верификации `docs/verification/gemini/core-09-subagent-dependency.md`.

## Verdict
PASS
