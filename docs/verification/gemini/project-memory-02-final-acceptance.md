# Project Memory 02 — Final acceptance

Tested commit: 78213658b35a2a18cb91193e64c64409c6431323
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0
DSH: 0.1.1-rc.2

## Lockfile

В связи с добавлением `@deepseek-ai/dsh-atomic-write@0.1.1-rc.2` в `peerDependencies` и `devDependencies` пакета `nishi-dsh-project-memory`, обновлен `pnpm-lock.yaml`:
- Изменение строго локализовано в importer `packages/project-memory`:
  ```yaml
  importers:
    packages/project-memory:
      dependencies:
        ...
      devDependencies:
        ...
        '@deepseek-ai/dsh-atomic-write':
          specifier: 0.1.1-rc.2
          version: 0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1))
  ```
- Несвязанный dependency churn отсутствует.
- Зафиксировано коммитом `78213658b35a2a18cb91193e64c64409c6431323` ("chore: refresh lockfile after memory atomic writer").

## Package gate

Проверка пакета `nishi-dsh-project-memory`:
1. `pnpm --filter nishi-dsh-project-memory test`:
   - Выполнено: 24 теста
   - Результат: 24 pass, 0 fail (exit code 0)
2. `pnpm --filter nishi-dsh-project-memory check`:
   - `tsc -p tsconfig.json --noEmit` (exit code 0)
3. `pnpm --filter nishi-dsh-project-memory build`:
   - `tsc -p tsconfig.json` (exit code 0)

## Workspace gate

Команда: `pnpm verify:local`
- Exit code: 0
- Workspace check: PASS
- Workspace build: PASS
- Workspace tests: PASS (все тесты пакетов nishi-dsh-core, nishi-dsh-project-memory, nishi-dsh-codex, nishi-dsh-antigravity, nishi-dsh-claude, nishi-dsh-suite)
- Package contracts: PASS
- Сформировано ровно 6 tarball версии `0.1.0-rc.3` в `.artifacts/packs/`:
  - `nishi-dsh-antigravity-0.1.0-rc.3.tgz`
  - `nishi-dsh-claude-0.1.0-rc.3.tgz`
  - `nishi-dsh-codex-0.1.0-rc.3.tgz`
  - `nishi-dsh-core-0.1.0-rc.3.tgz`
  - `nishi-dsh-project-memory-0.1.0-rc.3.tgz`
  - `nishi-dsh-suite-0.1.0-rc.3.tgz`

## Atomic writer

Миграция на общий atomic writer:
1. `packages/project-memory/src/filesystem.ts` импортирует `writeFileAtomic` из `@deepseek-ai/dsh-atomic-write`.
2. Старая ручная реализация удалена (`randomUUID`, `.tmp-*`, прямые вызовы `rename`, ручной `rm` отсутствуют: 0 совпадений по `rg -n "randomUUID|\.tmp-|rename\(" packages/project-memory/src`).
3. `writeSafeFileAtomically()` валидирует каноническую директорию перед записью (`validateCanonicalDirectory(dirPath)`).
4. Существующий target:
   - symlink -> reject;
   - non-file -> reject;
   - missing -> разрешен.
5. Файлы создаются/заменяются с правами `mode: 0o644`.
6. Необоснованный `withFileLock` не добавлялся.
7. Аудит callers: все вызывающие функции (`bootstrap.ts`, `topics.ts`, `init.ts`) работают с текстовыми данными UTF-8 и создают Buffer из UTF-8 строк. Бинарные вызовы отсутствуют.

Безопасность symlink:
- Тесты `packages/project-memory/test/atomic-write.test.ts` подтверждают:
  - bootstrap write отклоняет pre-existing symlink target, внешний референт остается неизменным byte-for-byte;
  - topic write отклоняет pre-existing symlink target, внешний референт остается неизменным byte-for-byte;
- Тесты `packages/project-memory/test/project-memory.test.ts` подтверждают:
  - отклонение symlink `.dsh`;
  - отклонение symlink `.dsh/memory`;
  - отклонение symlink `MEMORY.md`.
- На Linux все соответствующие тесты успешно выполнены.

Probe нормальной атомарной записи (`/tmp` probe):
- Создан тестовый проект, выполнены:
  - запись bootstrap `MEMORY.md`;
  - запись topic `architecture.md`;
  - редактирование topic `architecture.md`;
  - редактирование bootstrap `MEMORY.md`;
  - обратное чтение всех данных.
- Результат:
  - контент полный и консистентный;
  - частичные файлы и сиротские `*.tmp` отсутствуют;
  - права файлов соответствуют `644` (group/world write отсутствуют);
  - вложенные `.dsh` не создаются.

## Maintenance commands

Cordis injection `commands` + `llm`:
- В `packages/project-memory/src/commands.ts` регистрация команд переведена на `ctx.inject(['commands', 'llm'], (commandCtx) => registerInto(commandCtx))`.
- Устранен Cordis 4 lifecycle bug, при котором `commandCtx.llm` был недоступен без явного объявления сервиса в `inject`.

Реальный Cordis probe (`@deepseek-ai/cordis@4.0.1`):
- Создан изолированный тестовый контекст Cordis, вызвана функция `registerMemoryCommands(rootCtx)` до регистрации сервисов.
- Подтверждено, что до появления обоих сервисов команды не регистрируются.
- После монтирования `CommandsService` и `LlmService` deferred inject активирует регистрацию команд `/memory` и `/consolidate`.
- Вызов handler команды `memory` с неизвестным провайдером (`missing-provider/model-x`) возвращает точный ответ:
  `Unknown provider "missing-provider".`
  Это доказывает, что handler успешно получает доступ к `commandCtx.llm` и вызывает `listProviders()` без ошибок доступа к Cordis proxy.
- Вызов с валидным селектором `fixture/model-x` успешно разрешает маршрут и планирует maintenance turn.

Обзор lifecycle обслуживания (`scheduleMaintenanceTurn`):
- Селекция модели (`installModelSelection`) применяется строго для maintenance turn.
- Активные агенты отслеживаются через `activeMaintenanceAgents` (`WeakSet<Agent>`), повторный запуск maintenance command на том же агенте блокируется.
- Регистрация слушателей событий (`agent/pre-step`, `agent/error`, `agent/turn-stopping`, `agent.whenIdle()`) гарантирует идемпотентную очистку ресурсов и сброс селекции модели при завершении, остановке или ошибке.
- Ошибки вызова `agent.steer()` корректно перехватываются с обязательным вызовом `cleanup()`.

## Root consistency

Подтверждение согласованности корня проекта:
- `findProjectRoot(cwd, signal)` используется единообразно в context injection (`runtime.ts`) и в memory tools (`tools.ts`).
- Любой вложенный рабочий каталог внутри одного git-репозитория детерминированно разрешается в общий канонический корень репозитория.
- Корректно обрабатываются `.git` каталоги и `.git` файлы (git worktree / submodule).
- Вне git-репозитория используется нормализованный абсолютный `cwd`.
- Относительный или отсутствующий `cwd` завершается ошибкой (fail-closed).
- Запись memory tool из вложенного `cwd` не создает вложенную директорию `.dsh`.

## Tools

Контракты инструментов:
- `memory_read`:
  - возвращает `{ topic, exists, content }`;
  - отсутствующий топик -> `exists: false`, `content: null`;
  - специальный топик `memory` читает bootstrap `MEMORY.md`;
  - не создает файлы автоматически при чтении.
- `memory_write`:
  - создает топик или перезаписывает существующий;
  - автоматически обновляет раздел `## Memory map` в `MEMORY.md`;
  - специальный топик `memory` обновляет bootstrap `MEMORY.md`;
  - соблюдает лимит 256 KiB на файл топика;
  - соблюдает лимиты bootstrap (<= 25 KiB, <= 200 строк).
- `memory_edit`:
  - выполняет детерминированную замену единственного точного вхождения `old_text`;
  - при 0 вхождений или >1 вхождений (включая перекрывающиеся) завершается ошибкой;
  - проверяет результирующий размер после редактирования.
- Валидация идентификаторов топиков:
  - регулярное выражение `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`;
  - длина до 64 символов;
  - зарезервированные имена (`memory`, системные имена устройств Windows) отклоняются;
  - path traversal исключен.

## Initialization

Контракт `initializeDshProject()`:
- Идемпотентно создает при отсутствии:
  - `DSH.md`
  - `.dsh/project.json` (`schemaVersion: 1`)
  - `.dsh/memory/MEMORY.md`
  - `.dsh/local/`
  - запись `.dsh/local/` в `.gitignore`
- Не перезаписывает существующие пользовательские файлы.
- Fail-closed: завершается ошибкой при поврежденном `project.json`, наличии symlink на канонических путях или non-regular entries.

## Context injection

Контракт `registerProjectContextRuntime()`:
- Регистрирует `agent/pre-step` хук с `prepend: true`.
- Не инжектирует дублирующий контекст (проверяет историю сообщений и видимые surface nodes).
- Не создает отдельного запроса для пустого решения первого шага (`step === 1 && decision.messages.length === 0`).
- Ленивая инициализация проекта с дедупликацией параллельных вызовов (`inFlightInits`).
- Детерминированный рендеринг `DSH.md` и `MEMORY.md` в markdown без автоматической конкатенации файлов топиков.
- Строгий лимит bootstrap: <= 25 KiB / <= 200 строк.

## Memory policy

Политика директив памяти:
- Обе директивы (`MEMORY_MAINTENANCE_DIRECTIVE` и `MEMORY_CONSOLIDATION_DIRECTIVE`) прямо запрещают сохранение:
  - секретов, токенов, паролей, credentials;
  - текущих значений квот и утилизации;
  - сырых рассуждений (chain-of-thought) и логов;
  - персональных фактов об операторе (имя, аккаунты, ОС/машина, привычки и предпочтения шелла/инструментов).
- `MEMORY_CONSOLIDATION_DIRECTIVE` явно предписывает удалять персональные факты об операторе, если они были сохранены ранее, поскольку память проекта коммитится и распространяется вместе с репозиторием.

## Package/API contract

- `packages/project-memory/package.json`:
  - `version: 0.1.0-rc.3`
  - `peerDependencies` и `devDependencies` содержат `@deepseek-ai/dsh-atomic-write: 0.1.1-rc.2`
  - протоколы `link:` и `file:` отсутствуют.
- `packages/project-memory/lib/index.d.ts`:
  - экспортирует канонический публичный API (`paths`, `bootstrap`, `topics`, `context`, `init`, `name`, `inject`, `apply`);
  - внутренние хелперы (`projectRootFromToolExecution`, `registerMemoryCommands`, `resolveModelSelector`) не выходят за пределы предназначенных модулей.

## Disposable install

Команда:
```bash
node scripts/verify-bundle-install.mjs \
  --profile nishi-memory-rc3-acceptance \
  --suite .artifacts/packs/nishi-dsh-suite-0.1.0-rc.3.tgz \
  --dsh-home "$MEMORY_ACCEPTANCE_HOME" \
  --local-pack-dir .artifacts/packs \
  --dsh-bin dsh
```
- Disposable `DSH_HOME`: `/tmp/nishi-memory-rc3-EuY6CF`
- Exit code: 0
- Подтверждено:
  - peer dependency `dsh-atomic-write` разрешается в установленном DSH profile с `autoInstallPeers: false`;
  - установка, повторная сверка и удаление Suite прошли успешно;
  - замыкание зависимостей свободно от вендорных CLI-рантаймов и бинарных файлов.

## Real DSH boot

Процедура проверки:
1. Создан изолированный disposable `DSH_HOME` (`/tmp/nishi-memory-boot-bBWqsx`).
2. Профиль `nishi-memory-boot-acceptance` инициализирован с пакетами Nishi Suite rc.3 и бандлом `@deepseek-ai/dsh-web-app`.
3. Запущен сервер DSH:
   ```bash
   DSH_HOME="$DSH_HOME" dsh --profile nishi-memory-boot-acceptance --no-open --port 39487
   ```
4. HTTP probe:
   - Readiness status: 1
   - HTTP response code: `200 OK`
   - Log output: `dsh web: http://127.0.0.1:39487`
5. В логах сервера отсутствуют:
   - `cannot get property "llm" without inject`
   - `cannot get property "commands" without inject`
   - ошибки загрузки плагинов и дерева Cordis
   - неразрешенные модули или peer dependencies
6. Процесс штатно и корректно остановлен сигналом `SIGTERM`.

## Source-wide audit

Результаты сканирования `rg -n "header\.cwd|resolveProjectMemoryPaths|\.dsh|writeFile|writeFileAtomic|rename|randomUUID|ctx as any|\.llm|ctx\.inject" packages/project-memory/src`:
- `header.cwd`: доступен только внутри `tools.ts` и `runtime.ts`, всегда нормализуется через вызов `findProjectRoot()`.
- `resolveProjectMemoryPaths`: чистый детерминированный маппер путей `.dsh`.
- `.dsh`: каноническая структура каталогов `.dsh/`, `.dsh/memory/`, `.dsh/local/`, `.dsh/project.json`.
- `writeFile`: используется исключительно с флагом `{ flag: 'wx' }` при первичной инициализации отсутствующих файлов (`init.ts`, `bootstrap.ts`). Не используется для replacement.
- `writeFileAtomic`: используется во всех путях обновления и замены файлов через `writeSafeFileAtomically()`.
- `rename`, `randomUUID`: 0 совпадений.
- `ctx as any`: используется строго в type assertions Cordis lifecycle.
- `.llm`, `ctx.inject`: объявлены требуемые сервисы `['commands', 'llm']`.

Вендорные credentials, сессии и специфическая провайдерная логика в пакете отсутствуют.

## Known limits

1. Платформа Windows: `NOT TESTED` (проверка выполнялась в среде Linux x86_64).
2. Межпроцессная конкурентная запись нескольких независимых процессов DSH в один репозиторий не входит в требования single-process harness rc.3.
3. Отсутствие инструмента `memory_delete`: осознанное решение дизайна (директивы запрещают удаление через bash).

## Core freeze

Проверка истории git:
```bash
git diff 6da5a641a6843a3929cc6277eb79fe8b13fe2e32..HEAD -- packages/core
```
Diff пуст: `packages/core` не модифицировался в ходе работ над project memory. Core 14 Final Acceptance остается историческим PASS.

## Blocking issues

NO BLOCKING ISSUES FOUND.

## Verdict

PASS
