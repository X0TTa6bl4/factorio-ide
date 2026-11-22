---
type: subtask
status: done
priority: high
created: 2026-11-14
updated: 2026-11-19
parent: ./0000-selector.md
---
# Каталог, качество и время

Родитель: [задача](0000-selector.md). Реализовать stack-size, rocket-capacity, quality-filter, quality-transfer, quality-select и time в поддержанных профилях.

## Skills этого шага

- Реализация: `repo-orientation-ru`; проверка: Docker-тесты, `ci-failure-fix` при сбое.

## Границы и результат

Выполнить только результат этого шага; общую инфраструктуру и соседние устройства не переопределять.

## План и критерии приёмки

- [x] Реализован самостоятельный результат шага с диагностикой ошибок.
- [x] Соответствующие строки [матрицы](media/test-matrix.md) покрыты тестами; спорные игровые случаи имеют эталон или явно остаются открытыми.

## Проверка

Фактический прогон записан в [родителе](0000-selector.md): `test:full` 217/217, `src/selector.js` и `src/item-facts.js` 100%.
