# Core 08 — Vendor failure validation

Tested commit: 0a60abd1de022612d2d5ca73cabc3b834a6a81ac
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 0
Result: PASS

Все 156 тестов пакета `nishi-dsh-core` завершились успешно (включая все 13 тестов в `packages/core/test/failure.test.ts`).

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

## Regression fix
В коммите `0a60abd1de022612d2d5ca73cabc3b834a6a81ac` исправлен входной тестовый аргумент в `packages/core/test/failure.test.ts`:
- Предыдущий вызов `recognizeVendorStderr('anything', [{ category: 'x', pattern: /x/, message: () => '' }])` передавал строку `'anything'`, не содержащую символ `'x'`. Из-за отсутствия совпадения паттерна цикл `recognizeVendorStderr` завершался без вызова колбэка `recognizer.message`.
- Обновлённый тест использует строку `'x'`: `recognizeVendorStderr('x', [{ category: 'x', pattern: /x/, message: () => '' }])`. Паттерн `/x/` успешно сопоставляется со строкой `'x'`, вызывается колбэк `message`, возвращающий пустую строку `''`, и срабатывает проверка `typeof message !== 'string' || message.trim().length === 0`.
- Функция `recognizeVendorStderr` выбрасывает исключение с сообщением `'nishi-core: vendor stderr recognizer.message must return a non-empty string'`, полностью подтверждая fail-closed валидацию результата `recognizer.message`.

## VendorFailure contract
- **Форматирование сообщения**: Базовый шаблон ошибки обновлён на вендор-нейтральный: `Vendor CLI failure (product: ${product}; stage: ${stage}; category: ${category}).${detail}`. Устаревшая формулировка `"Product subagent failure"` полностью удалена.
- **Структурированные поля**:
  - `product`, `stage`, `category` — обязательные непустые строки (проверяются через `requireNonEmptyString`, whitespace-only строки отклоняются).
  - `httpStatus` — опциональный safe integer в диапазоне 100..599 (`null` и нецелые/out-of-range значения отклоняются).
  - `exitCode` — опциональный неотрицательный safe integer или `null` (`null` сохраняется как явное значение).
  - `signal` — опциональная непустая строка или `null` (`null` сохраняется как явное значение).
  - `cause` — сохраняется через стандартный механизм `Error.cause` (`super(..., spec.cause !== undefined ? { cause: spec.cause } : undefined)`).
- **Изоляция метаданных**: Поля `httpStatus`, `exitCode`, `signal` хранятся строго в типизированных свойствах объекта ошибки и не интерполируются в текст сообщения.
- **Типизация и иерархия**: `VendorFailure` наследует `Error`, имеет имя `'VendorFailure'` и сохраняет корректное поведение `instanceof`.

## RegExp determinism
- **Изоляция состояния `RegExp`**: Функция `execRecognizer` изолирует регулярные выражения через клонирование: `new RegExp(pattern.source, pattern.flags).exec(stderrText)`.
- **Детерминизм `/g` и `/y`**: Каждый вызов распознавания стартует со свежего экземпляра с `lastIndex = 0`. Повторные вызовы с одинаковыми входными данными дают строго детерминированный результат.
- **Сохранение состояния вызывающего кода**: Исходный объект `pattern` вызывающего кода не мутируется (его свойство `lastIndex` остаётся неизменным независимо от совпадения). Если вызывающий код заранее передал `pattern` с `lastIndex !== 0`, поиск всё равно корректно начинается с индекса 0.
- **Сохранение флагов и порядка**: Все флаги (`i`, `m`, `s`, `u`, `g`, `y`, `d`, `v`) сохраняются через `pattern.flags`. Порядок обработки распознавателей строго следует правилу *first-match-wins*.

## Security review
- **Изоляция raw stderr**: Необработанный `stderrText` процесса вендорного CLI никогда автоматически не включается ядром в `VendorFailure.message`, diagnostics или DTO.
- **Граница ответственности**: `recognizeVendorStderr` возвращает только `{ category: recognizer.category, message: recognizer.message(match) }`. Документация в коде честно и однозначно фиксирует контракт: колбэк `message(match)` получает массив совпадений `RegExpExecArray` и отвечает за цитирование только извлечённых доменных токенов (например, имени разрешения), не включая окружающий несанитизированный текст.
- **Безопасность исключений ядра**: Ошибки валидации входных спецификаций и распознавателей внутри ядра никогда не логируют и не включают `stderrText`.

## Additional review
NO BLOCKING ISSUES FOUND.

## Verdict
PASS
