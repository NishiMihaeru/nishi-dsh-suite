# Core 08 — Vendor failure validation

Tested commit: 033281591b3871353fe498ae3666d13b9ba51c50
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 1
Result: FAIL

155 тестов завершились успешно (pass), 1 тест завершился ошибкой:
- Тест `'malformed recognizers fail closed instead of silently becoming non-matches'` в `packages/core/test/failure.test.ts:181` упал с `AssertionError [ERR_ASSERTION]: Missing expected exception.`
- Причина: `recognizeVendorStderr('anything', [{ category: 'x', pattern: /x/, message: () => '' }])` передаёт строку `'anything'`, которая не содержит символ `'x'`. Регулярное выражение `/x/` возвращает `null`, блок `if (!match) continue` пропускает итерацию, функция `recognizer.message` не вызывается, и функция возвращает `undefined` без исключения.

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

## VendorFailure contract
Контракт ошибки `VendorFailure` и спецификации `VendorFailureSpec` в `packages/core/src/runtime/failure.ts`:
- **Форматирование сообщения**: Базовое сообщение формируется вендор-нейтрально: `Vendor CLI failure (product: ${product}; stage: ${stage}; category: ${category}).${detail}`. Устаревшая формулировка `"Product subagent failure"` полностью удалена.
- **Структурированные поля класса `VendorFailure`**:
  - `readonly product: string` — имя продукта вендора (например, `'Antigravity CLI'`, `'Vendor CLI'`).
  - `readonly stage: string` — этап жизненного цикла (например, `'startup'`, `'turn'`, `'shutdown'`).
  - `readonly category: string` — именованная категория ошибки (например, `'permission-denied'`, `'timeout'`, `'provider-error'`).
  - `readonly httpStatus: number | undefined` — HTTP статус ответа протокола вендора (100..599).
  - `readonly exitCode: number | null | undefined` — код завершения процесса вендорного CLI.
  - `readonly signal: string | null | undefined` — сигнал завершения процесса вендорного CLI.
  - `readonly cause: unknown` — базовая причина ошибки, сохраняемая через стандартный `Error.cause` (`super(..., spec.cause !== undefined ? { cause: spec.cause } : undefined)`).
- **Валидация спецификации (`VendorFailureSpec`)**:
  - `spec` обязан быть не-null объектом (`!spec || typeof spec !== 'object' || Array.isArray(spec)`).
  - `product`, `stage`, `category` обязательны, должны быть строками, непустыми и не состоящими только из пробелов (проверяются через `requireNonEmptyString`).
  - `detail` опционален; если передан, обязан быть строкой (`typeof spec.detail === 'string'`), иначе выбрасывается исключение. Если не пустой, добавляется в конец `message` через пробел.
  - `httpStatus` опционален; если передан, валидируется через `Number.isSafeInteger(value) && value >= 100 && value <= 599`. Значения `null`, числа с плавающей точкой, `NaN`, `Infinity` и числа вне диапазона 100..599 отклоняются.
  - `exitCode` опционален; допускает `undefined`, `null` или неотрицательный safe integer (`Number.isSafeInteger(value) && value >= 0`). Отрицательные числа, дробные значения и `Infinity` отклоняются. `null` сохраняется как явное значение.
  - `signal` опционален; допускает `undefined`, `null` или непустую строку (whitespace-only строки отклоняются через `requireNonEmptyString`). `null` сохраняется как явное значение.
  - Метаданные транспорта и процесса (`httpStatus`, `exitCode`, `signal`) хранятся строго в типизированных полях и автоматически не добавляются в `message`.
  - `VendorFailure` наследует `Error`, имеет `name = 'VendorFailure'`, сохраняет `instanceof Error` и `instanceof VendorFailure`.

## RegExp determinism
Анализ детерминизма распознавания `stderr` через `recognizeVendorStderr`:
- **Устранение регрессии с `lastIndex`**:
  - В предыдущей реализации `recognizeVendorStderr` выполнял `recognizer.pattern.exec(stderrText)` напрямую на объекте `RegExp`, принадлежащем вызывающему коду.
  - Для регулярных выражений с флагами `/g` (global) и `/y` (sticky) вызов `exec()` мутировал внутреннее свойство `pattern.lastIndex`. При повторных вызовах с тем же регулярным выражением или входной строкой поиск начинался с ненулевого смещения, что приводило к пропуску совпадений или недетерминированному поведению.
  - В коммите `4e8ae3e` функция `execRecognizer` изолирует состояние регулярного выражения: `new RegExp(pattern.source, pattern.flags).exec(stderrText)`.
  - Каждый вызов распознавания создаёт свежий клон `RegExp` с начальным `lastIndex = 0`.
- **Характеристики клонирования**:
  - Исходный объект `pattern` вызывающего кода не мутируется (`pattern.lastIndex` сохраняет исходное значение).
  - Даже если вызывающий код заранее выставил `pattern.lastIndex !== 0`, распознавание всегда начинается с индекса 0.
  - Повторные последовательные вызовы с одинаковым входным `stderrText` и глобальным `/g` или sticky `/y` паттерном возвращают идентичный детерминированный результат.
  - Флаги регулярного выражения (`i`, `m`, `s`, `u`, `g`, `y`, `d`, `v`) полностью сохраняются через свойство `pattern.flags`.
  - Порядок применения распознавателей строго сохраняет принцип *first-match-wins*.
  - Пустой, неопределённый (`undefined`) или несовпавший `stderrText` корректно возвращает `undefined`.

## Security review
Граница безопасности между ядром (`nishi-dsh-core`) и пользовательскими распознавателями:
- **Изоляция raw stderr**: Неизменяемый инвариант безопасности ядра — необработанный текст `stderr` вендорного CLI никогда автоматически не включается в сообщения об ошибках, diagnostics или DTO.
- **Структура результата**: `recognizeVendorStderr` возвращает только `{ category: recognizer.category, message: recognizer.message(match) }`.
- **Проверка тестами**: Тест подтверждает, что специфичные пути и служебный текст из raw stderr вендора (например, `jetski`, `settings.json`, `permissions.allow`, `--dangerously-skip-permissions`) не попадают в итоговое сообщение распознанной ошибки.
- **Граница ответственности (contract & docstrings)**: В соответствии с документацией в `packages/core/src/runtime/failure.ts`, функция обратного вызова `message(match: RegExpExecArray)` получает массив совпадений регулярного выражения и отвечает за форматирование только выделенных токенов доменной модели (например, имени разрешения `"read_file"`). Ответственность за невключение окружающего raw-контекста лежит на авторе `recognizer.message`.
- **Исключения ядра**: Внутренние ошибки валидации ядра никогда не логируют и не включают `stderrText` в текст исключений.

## Public API
- **Экспорт из `nishi-dsh-core/runtime`**:
  В `packages/core/src/runtime/index.ts` экспортируются:
  - Класс `VendorFailure` и фабрика `vendorFailure`.
  - Функция `recognizeVendorStderr`.
  - Типы `VendorFailureSpec`, `VendorStderrRecognizer`, `RecognizedVendorStderr`.
- **Сгенерированные `.d.ts` типы**:
  `tsdown` генерирует типизацию в `packages/core/lib/runtime.d.ts`, где свойства `httpStatus?: number`, `exitCode?: number | null`, `signal?: string | null` в `VendorFailureSpec` опциональны для вызывающего кода, а на экземпляре `VendorFailure` представлены как `readonly httpStatus: number | undefined`, `readonly exitCode: number | null | undefined`, `readonly signal: string | null | undefined`.
- **Отсутствие вендор-специфичного кода**: В `packages/core/src/runtime/failure.ts` и `packages/core/src/runtime/index.ts` нет зависимостей или ветвлений под конкретных провайдеров (`codex`, `antigravity`, `claude`).

## Future provider migration targets
Файлы и локальные классы ошибок в пакетах провайдеров, подлежащие последующей миграции на `VendorFailure`:
- `packages/antigravity/src/usage.ts`: класс `AntigravityUsageSourceError`
- `packages/antigravity/src/web-search-backend.ts`: класс `AntigravityWebSearchBackendError`
- `packages/antigravity/src/antigravity-primary.ts`: ad-hoc вызовы `throw new Error(...)` и отклонения промисов при обнаружении моделей, выходе процесса до получения результата и сбоях выполнения
- `packages/claude/src/usage.ts`: класс `ClaudeUsageSourceError`
- `packages/codex/src/usage.ts`: класс `CodexRateLimitsSourceError`
- `packages/codex/src/web-search-backend.ts`: класс `CodexWebSearchBackendError`
- `packages/codex/src/codex-plugin-dsh/adapter.ts`: ad-hoc вызовы `throw new Error(...)` при обработке динамических вызовов инструментов, отсутствующей сессии, завершении ходов
- `packages/codex/src/codex-plugin-dsh/app-server.ts`: ad-hoc вызовы `throw new Error(...)` при сбоях транспорта, инициализации и завершении процессов App Server
- `packages/codex/src/codex-plugin-dsh/history.ts`, `images.ts`, `tools.ts`: ad-hoc проверки и генерация ошибок для полезной нагрузки сессий

## Additional review
1. **BLOCKING ISSUE — Ошибка в тестовом наборе (`packages/core/test/failure.test.ts:181`)**:
   - В тесте `'malformed recognizers fail closed instead of silently becoming non-matches'`:
     ```ts
     assert.throws(
       () => recognizeVendorStderr('anything', [{ category: 'x', pattern: /x/, message: () => '' }]),
       /recognizer\.message must return a non-empty string/,
     )
     ```
   - Тест передаёт `stderrText = 'anything'` и регулярное выражение `pattern = /x/`.
   - Так как строка `'anything'` не содержит символа `'x'`, `execRecognizer` возвращает `null`.
   - В `recognizeVendorStderr` срабатывает `if (!match) continue`, цикл завершается и функция возвращает `undefined`.
   - Колбэк `recognizer.message` не вызывается, исключение `/recognizer\.message must return a non-empty string/` не выбрасывается, и `assert.throws` падает с ошибкой `Missing expected exception`.
   - *Примечание*: Реализация валидации `typeof message !== 'string' || message.trim().length === 0` в `failure.ts` корректна, но вызывается только при наличии совпадения паттерна (`if (!match) continue`). Для того чтобы проверка в тесте сработала, входная строка должна соответствовать паттерну (например, `recognizeVendorStderr('x', ...)` или `pattern: /anything/`).
2. **Изоляция подклассов RegExp**:
   - `execRecognizer` выполняет `new RegExp(pattern.source, pattern.flags)`, что гарантирует создание чистого стандартного экземпляра `RegExp` и защищает от переопределения метода `exec` в пользовательских подклассах.
3. **Последовательная валидация массива recognizers**:
   - Элементы массива `recognizers` валидируются итерируемо в цикле `for`. Если один из первых распознавателей совпал, последующие некорректные элементы массива не проверяются.
4. **Валидация `httpStatus` vs `exitCode`/`signal`**:
   - `httpStatus` не принимает значение `null` (только `number` или `undefined`), в то время как `exitCode` и `signal` явно допускают `null` для фиксации отсутствия кода завершения/сигнала процесса.

## Working tree
Состояние рабочей копии до проверки:
- Ветка `feat/core-provider-plugins-rc3` обновлена через `git pull --ff-only` до коммита `033281591b3871353fe498ae3666d13b9ba51c50`.
- Рабочее дерево было полностью чистым (`git status --short` пуст).

## Verdict

FAIL

Причина:
- Команда `pnpm --filter nishi-dsh-core test` завершилась с кодом 1 из-за упавшего теста в `packages/core/test/failure.test.ts:181`.
- Хотя `check` и `build` прошли успешно (exit code 0), а реализация `VendorFailure` и клонирования регулярных выражений в `packages/core/src/runtime/failure.ts` корректна, согласно правилам валидации вердикт PASS выставляется строго при exit code 0 у команды `test`.
