#!/usr/bin/env python3
"""Move the signal catalog task before engine tasks; dry-run unless --apply."""

import argparse
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import uuid


EPIC = Path('.cursor/tasks/0001-epic-_-f-logic-implementation')
CATALOG_SUFFIX = '-task-_-signal-constant-catalog'
TASK_NAME = re.compile(r'^(\d{4})-(?:task|bug)-.+$')


def plan(root):
    epic = root / EPIC
    if not epic.is_dir() or epic.is_symlink():
        raise ValueError('Не найден обычный каталог эпика: ' + str(epic))
    tasks = sorted(p for p in epic.iterdir() if TASK_NAME.fullmatch(p.name))
    if any(not p.is_dir() or p.is_symlink() for p in tasks):
        raise ValueError('Задачи должны быть обычными каталогами, без symlink.')
    numbers = [int(p.name[:4]) for p in tasks]
    if numbers != list(range(1, len(tasks) + 1)):
        raise ValueError('Ожидается непрерывная нумерация задач с 0001 без дублей.')
    catalog = [p for p in tasks if p.name.endswith(CATALOG_SUFFIX)]
    if len(catalog) != 1:
        raise ValueError('Нужна ровно одна задача signal-constant-catalog.')
    if not tasks[0].name.endswith('-task-_-development-environment'):
        raise ValueError('Первой должна оставаться задача development-environment.')
    order = [tasks[0], catalog[0]] + [p for p in tasks[1:] if p != catalog[0]]
    names = {p.name: f'{n:04d}' + p.name[4:] for n, p in enumerate(order, 1)}
    names = {old: new for old, new in names.items() if old != new}
    for target in names.values():
        if (epic / target).exists() and target not in names:
            raise ValueError('Целевой каталог уже существует: ' + target)
    return epic, names


def documents(root, epic):
    files = {root / 'AGENTS.md', root / 'README.md', root / '.cursor/README.md',
             root / '.cursor/tasks/README.md'}
    for directory in [root / '.cursor/docs', epic]:
        files.update(directory.rglob('*.md'))
    files.update((root / 'data').rglob('README.md'))
    return sorted(p for p in files if p.is_file() and not p.is_symlink())


def edits(root, epic, names):
    # One substitution pass prevents 0023 -> 0002 -> 0003 cascades.
    mapping = dict(names)
    mapping.update({old[:4]: new[:4] for old, new in names.items()})
    pattern = re.compile('|'.join(re.escape(n) for n in sorted(names, key=len, reverse=True))
                         + r'|(?<![A-Za-z0-9_])(?:'
                         + '|'.join(re.escape(n[:4]) for n in names)
                         + r')(?![A-Za-z0-9_])')
    changes = []
    for path in documents(root, epic):
        before = path.read_bytes()
        after = pattern.sub(lambda m: mapping[m.group()], before.decode('utf-8')).encode('utf-8')
        if before != after:
            changes.append((path, before, after, stat.S_IMODE(path.stat().st_mode)))
    return changes


def relocated(path, epic, names):
    try:
        relative = path.relative_to(epic)
    except ValueError:
        return path
    if relative.parts and relative.parts[0] in names:
        return epic / names[relative.parts[0]] / Path(*relative.parts[1:])
    return path


def atomic_write(path, data, mode):
    fd, name = tempfile.mkstemp(prefix='.renumber-write-', dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        temp.chmod(mode)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def apply(epic, names, changes):
    # Refuse a stale plan before moving directories or writing any files.
    if any(path.read_bytes() != before for path, before, _, _ in changes):
        raise ValueError('Файлы изменились после подготовки плана. Повторите запуск.')
    moved, written = [], []
    try:
        temporary = {}
        for old in names:
            source = epic / old
            temp = epic / ('.renumber-' + uuid.uuid4().hex)
            source.rename(temp)
            moved.append((source, temp))
            temporary[old] = temp
        for old, new in names.items():
            target = epic / new
            if target.exists():
                raise ValueError('Целевой каталог появился во время работы: ' + str(target))
            temporary[old].rename(target)
            moved.append((temporary[old], target))
        for path, before, after, mode in changes:
            target = relocated(path, epic, names)
            if target.read_bytes() != before:
                raise ValueError('Файл изменён другим процессом: ' + str(target))
            atomic_write(target, after, mode)
            written.append((target, before, mode))
    except BaseException:
        failures = []
        for target, before, mode in reversed(written):
            try:
                atomic_write(target, before, mode)
            except OSError as error:
                failures.append(str(error))
        for source, target in reversed(moved):
            try:
                target.rename(source)
            except OSError as error:
                failures.append(str(error))
        if failures:
            raise RuntimeError('Не удалось полностью откатить изменения: ' + '; '.join(failures))
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Применить переименование и правки ссылок.')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2],
                        help='Корень проекта; по умолчанию определяется относительно скрипта.')
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        epic, names = plan(root)
        if not names:
            print('Каталог сигналов уже второй. Изменения не требуются.')
            return 0
        changes = edits(root, epic, names)
        for old, new in sorted(names.items()):
            print(old + ' -> ' + new)
        print(f'Каталогов: {len(names)}; документов со ссылками/номерами: {len(changes)}.')
        if args.apply:
            apply(epic, names, changes)
            print('Готово. Номера 0000/0100/0200 и глобальный .task-sequence сохранены.')
        else:
            print('Предпросмотр: файлы не изменены. Для применения добавьте --apply.')
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print('Ошибка: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
