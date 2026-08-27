# Core 02 — UTF-8 stream validation

Tested commit: 7b5fb9abf45ccd9e75ab4bfc347dd62e7d0e6c50
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

## Regression scenario

Тест `outputLines preserves a UTF-8 code point split across Buffer chunk boundaries` в [packages/core/test/process.test.ts](file:///home/acedia/Проекты/nishi-dsh-suite/packages/core/test/process.test.ts):
- Использует 3-байтовый UTF-8 символ евро (`€`, байты `0xE2, 0x82, 0xAC`).
- Первый chunk отправляет префикс `{"text":"` и первые 2 байта символа (`euro.subarray(0, 2)`).
- Второй chunk (`stdout.end`) отправляет оставшийся 1 байт (`euro.subarray(2)`) и суффикс `"}\n"`.
- Тест валидирует, что декодированный поток восстанавливает исходную строку `{"text":"€"}` без появления replacement characters (`U+FFFD`) или повреждения JSON/NDJSON структуры.

Тест корректно и физически разделяет байты одного UTF-8 code point между двумя отдельными Buffer chunks и подтверждает восстановление символа потоковым декодером.

## Decoder review

1. **Многобайтный UTF-8 code point корректно переживает границу Buffer chunks**: Да. Используется `node:string_decoder.StringDecoder('utf8')`, который буферизует неполные байтовые последовательности между вызовами `.write()`.
2. **В результате не появляется U+FFFD / replacement character**: Да. Неполный UTF-8 символ не декодируется отдельным чанком через `Buffer.toString()`, а собирается целиком.
3. **Обычные ASCII fragmented chunks продолжают работать**: Да. Тест `outputLines decodes fragmented NDJSON across chunk boundaries without altering payload text` успешно проходит.
4. **CRLF продолжает обрабатываться корректно**: Да. Вспомогательный генератор `drainCompleteLines` и финальный блок обрезают завершающий `\r`, тест с `\r\n` успешно проходит.
5. **Последняя строка без newline продолжает возвращаться**: Да. После окончания потока вызывается `decoder.end()`, оставшийся буфер проверяется и возвращается; тест `outputLines yields a trailing unterminated line once the stream ends` проходит.
6. **maxBytes по-прежнему ограничивает размер декодированной строки**: Да. Проверка `Buffer.byteLength(line, 'utf8') > maxBytes` выполняется для каждой завершённой строки, для промежуточного буфера в цикле чтения и для финального незавершённого остатка.
7. **Вызов decoder.end() в конце потока корректно обрабатывает оставшееся decoder state**: Да. Вызов `buffered += decoder.end()` выполняется до финальной проверки строк и завершения генератора.
8. **Реализация не создаёт очевидной неограниченной буферизации**: Да. Завершённые строки сбрасываются через `yield* drainCompleteLines()`, а размер незавершённой строки в `buffered` проверяется против `maxBytes` на каждой итерации.
9. **Обработка string chunks вместе с Buffer/Uint8Array chunks не содержит очевидной ошибки состояния decoder**: Да. При получении строкового чанка вызывается `decoder.end()`, буферизованный остаток сбрасывается в `buffered`, а декодер пересоздаётся (`new StringDecoder('utf8')`), что изолирует состояние декодера.
10. **Существующие process tests не регрессировали**: Да. Все 118 тестов пакета `nishi-dsh-core` выполняются успешно.

NO BLOCKING ISSUES FOUND.

## Working tree

Состояние до проверки: чистый working tree (`git status --short` пуст), ветка `feat/core-provider-plugins-rc3`, HEAD на коммите `7b5fb9abf45ccd9e75ab4bfc347dd62e7d0e6c50`. Посторонние изменения отсутствуют.

## Verdict

PASS
