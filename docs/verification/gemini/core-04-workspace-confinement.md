# Core 04 — Workspace confinement validation

Tested commit: 8379a19309bd5988162f3e9711633c72fd9371e7
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

## Existing call sites
В кодовой базе обнаружены два реальных потребителя `ephemeralAgentWorkspace`:
1. `packages/antigravity/src/antigravity-primary.ts` (`ensureBridgeWorkspace`):
   - `prefix`: `'dsh-antigravity-primary-'` (ровно один сегмент, безопасный)
   - `agentName`: `'dsh-primary'` (ровно один сегмент, безопасный)
   - `files`: `[{ path: 'bridge-output.schema.json', content: JSON.stringify(BRIDGE_SCHEMA) }]` (валидный относительный portable path без dot-сегментов)
2. `packages/antigravity/src/web-search-backend.ts` (`search`):
   - `prefix`: `'dsh-web-search-agy-'` (ровно один сегмент, безопасный)
   - `agentName`: `'dsh-web-search'` (ровно один сегмент, безопасный)
   - `files`: `[{ path: 'search-output.schema.json', content: JSON.stringify(SEARCH_OUTPUT_SCHEMA) }]` (валидный относительный portable path без dot-сегментов)

Оба call site полностью удовлетворяют новому строгому контракту и не нарушают его.

## Confinement contract
- **`prefix`**: обязан быть непустой строкой, состоящей строго из одного сегмента без разделителей `/` или `\`, не равным `.` или `..`, и не содержащим `\0`.
- **`agentName`**: обязан быть непустой строкой, состоящей строго из одного сегмента без разделителей `/` или `\`, не равным `.` или `..`, и не содержащим `\0`.
- **`files[].path`**: обязан быть переносимым относительным путем относительно корня workspace:
  - непустая строка без символа NUL (`\0`);
  - запрещены абсолютные пути POSIX (`/foo`), Windows drive-qualified (`C:\foo`, `C:/foo`) и UNC (`\\server\share`);
  - запрещены обратные слеши `\` (контракт требует явного `/`);
  - запрещены пустые сегменты (например, `a//b`, `/a`, `a/`), dot-сегменты (`.`) и traversal-сегменты (`..`).

## Traversal regression coverage
В наборе тестов `packages/core/test/workspace.test.ts` проверяются:
- Опасные префиксы: `../escape-`, `..\\escape-`, `/tmp/escape-`, `C:\\escape-`.
- Опасные имена агента: `..`, `.`, `../escape`, `nested/name`, `nested\\name`, пустая строка `''`.
- Опасные и непереносимые пути файлов: `../escaped.txt`, `nested/../../escaped.txt`, `..\\escaped.txt`, `/tmp/escaped.txt`, `C:\\escaped.txt`, `./schema.json`, `nested//schema.json`.
- Корректная запись вложенных путей: `schemas/search-output.schema.json`.

## Filesystem ordering
Подтверждено: все входные параметры (`prefix`, `agentName`, `files[].path`, типы и структуры объектов) валидируются **до** вызова `tmpdir()` и `mkdtemp()`. Тесты явно проверяют счетчик вызовов `tmpdir()` и гарантируют 0 обращений к файловой системе при некорректных входных данных.

## Cleanup behavior
Подтверждено: если после успешного создания директории `mkdtemp()` происходит сбой на этапе записи `agent.md`, создания поддиректорий или записи `files` (например, конфликт файла и директории), блок `catch` выполняет `rm(root, { recursive: true, force: true })`, полностью удаляя частично созданный корень. Вызов `dispose()` идемпотентен, безопасен при повторных вызовах и никогда не выбрасывает исключений.

## Security review
Все 35 контрольных инвариантов и граничных случаев проверены:
- Invariants 1–6 (prefix validation & order): PASS.
- Invariants 7–11 (agentName validation & order): PASS.
- Invariants 12–22 (files[].path validation, portable separator, nesting): PASS.
- Invariants 23–26 (pre-validation before mkdtemp, resolveInside post-check, workspace containment): PASS.
- Invariants 27–29 (cleanup on partial failure, idempotent dispose, canonical agent.md path): PASS.
- Invariant 30 (call sites compliance): PASS.
- Invariants 31–35 (NUL byte handling, cross-platform POSIX/Windows separator semantics, defense-in-depth resolveInside, no mutation before validation, absence of provider-specific leaks in core): PASS.

NO BLOCKING ISSUES FOUND.

## Working tree
До проверки: чистое состояние репозитория на коммите `8379a19309bd5988162f3e9711633c72fd9371e7` ветки `feat/core-provider-plugins-rc3`. Посторонних изменений нет.

## Verdict
PASS
