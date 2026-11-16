#!/usr/bin/env python3
"""Build versioned base/Space Age signal prototype catalogs from official game data."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

PACKS = {
    'base': ['core', 'base'],
    'space-age': ['core', 'base', 'elevated-rails', 'quality', 'recycler', 'space-age'],
}
FILES = {
    'item': 'items', 'fluid': 'fluids', 'virtual': 'virtual-signals',
    'entity': 'entities', 'recipe': 'recipes', 'space-location': 'space-locations',
    'asteroid-chunk': 'asteroid-chunks', 'quality': 'qualities',
}
LOGIC = {'signal-everything': 'Everything', 'signal-anything': 'Anything', 'signal-each': 'Each'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value, records=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if records:
        content = '[\n' + ',\n'.join('  ' + json.dumps(v, ensure_ascii=False, sort_keys=True) for v in value) + '\n]\n'
    else:
        content = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    path.write_text(content)


def locales(root, packs, language):
    result = {}
    for pack in packs:
        for file in sorted((root / pack / 'locale' / language).glob('*.cfg')):
            section = ''
            for line in file.read_text(encoding='utf-8-sig').splitlines():
                if line.startswith('[') and line.endswith(']'):
                    section = line[1:-1]
                elif line and not line.startswith(('#', ';')) and '=' in line:
                    key, value = line.split('=', 1)
                    result[(section + '.' if section else '') + key] = value
    return result


class Catalog:
    def __init__(self, raw, translations):
        self.raw = raw
        self.locale = translations
        self.index = {}
        for prototype_type, rows in raw.items():
            for name, prototype in rows.items():
                signal_type = prototype.get('base_type', prototype_type)
                if signal_type == 'virtual-signal':
                    signal_type = 'virtual'
                self.index[(signal_type, name)] = prototype

    def main_product(self, p):
        results = p.get('results', [])
        if not isinstance(results, list):
            return None
        if p.get('main_product') == '':
            return None
        if p.get('main_product'):
            return next(((r.get('type', 'item'), r['name']) for r in results if r.get('name') == p['main_product']), None)
        if len(results) == 1:
            r = results[0]
            return (r.get('type', 'item'), r['name'])
        return None

    def localise(self, value, seen):
        if isinstance(value, (str, int, float)):
            return str(value)
        if not isinstance(value, list) or not value:
            return None
        key, *arguments = value
        if key == '':
            parts = [self.localise(v, seen) for v in arguments]
            return ''.join(parts) if all(v is not None for v in parts) else None
        if key == '?':
            return next((v for a in arguments if (v := self.localise(a, seen)) is not None), None)
        text = self.locale.get(key)
        if text is None:
            return None
        for i, argument in enumerate(arguments, 1):
            translated = self.localise(argument, seen)
            if translated is None:
                return None
            text = text.replace('__' + str(i) + '__', translated)
        def substitute(match):
            kind = {'ITEM': 'item', 'FLUID': 'fluid', 'ENTITY': 'entity', 'PLANET': 'space-location'}[match[1]]
            return self.name(kind, match[2], seen)[0] or match[0]
        text = re.sub(r'__(ITEM|FLUID|ENTITY|PLANET)__([\w-]+)__', substitute, text)
        # Keep unresolved localisation expressions in the raw field, not as a guessed label.
        if re.search(r'__[A-Za-z0-9_]+__', text):
            return None
        return text.replace('\\n', '\n')

    def name(self, kind, name, seen=None):
        seen = set() if seen is None else set(seen)
        if (kind, name) in seen:
            return None, 'unresolved'
        seen.add((kind, name))
        p = self.index.get((kind, name), {})
        if 'localised_name' in p:
            text = self.localise(p['localised_name'], seen)
            if text is not None:
                return text, 'localised_name'
        section = {'virtual': 'virtual-signal', 'space-location': 'space-location'}.get(kind, kind)
        key = section + '-name.' + name
        if key in self.locale:
            text = self.localise([key], seen)
            if text is not None:
                return text, key
        if kind == 'item':
            for key, target_kind in [('place_result', 'entity'), ('place_as_equipment_result', 'equipment')]:
                if p.get(key):
                    if target_kind == 'equipment':
                        text = self.locale.get('equipment-name.' + p[key])
                        if text:
                            return text, 'equipment-name.' + p[key]
                    text, origin = self.name(target_kind, p[key], seen)
                    if text is not None:
                        return text, origin
        if kind == 'recipe':
            target = self.main_product(p)
            if target:
                return self.name(*target, seen=seen)
        return None, 'unresolved'

    def icon(self, kind, name, seen=None):
        seen = set() if seen is None else set(seen)
        if (kind, name) in seen:
            return None
        seen.add((kind, name))
        p = self.index.get((kind, name), {})
        if p.get('icons'):
            return {'layers': p['icons'], 'source': 'icons'}
        if p.get('icon'):
            return {'layers': [{'icon': p['icon'], 'icon_size': p.get('icon_size', 64)}], 'source': 'icon'}
        if kind == 'recipe':
            target = self.main_product(p)
            if target:
                resolved = self.icon(*target, seen=seen)
                if resolved:
                    return {**resolved, 'source': 'main-product'}
        return None

    def records(self, kind, ru):
        result = []
        for (signal_type, name), p in self.index.items():
            if signal_type != kind:
                continue
            role = 'signal'
            if p.get('hidden'):
                role = 'internal'
            if p.get('parameter'):
                role = 'blueprint-parameter'
            if kind == 'virtual' and name in LOGIC:
                role = 'logic-selector'
            if kind == 'virtual' and name == 'signal-any-quality':
                role = 'quality-selector'
            en_name, en_origin = self.name(kind, name)
            ru_name, ru_origin = ru.name(kind, name)
            row = {
                'id': kind + '/' + name, 'type': kind, 'name': name,
                'prototypeType': p['type'], 'role': role,
                'hidden': bool(p.get('hidden')), 'parameter': bool(p.get('parameter')),
                'label': {'en': en_name or name, 'ru': ru_name or en_name or name},
                'labelSource': {'en': en_origin, 'ru': ru_origin},
                'icon': self.icon(kind, name),
            }
            for key in ('subgroup', 'order', 'stack_size', 'weight', 'localised_name', 'hidden_in_factoriopedia', 'hide_from_signal_gui', 'main_product', 'results', 'level', 'next', 'next_probability', 'factoriopedia_alternative'):
                if key in p:
                    row[key] = p[key]
            result.append(row)
        return sorted(result, key=lambda r: (r.get('subgroup', ''), r.get('order', ''), r['name']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path, help='Extracted official factorio/data directory')
    parser.add_argument('--output', required=True, type=Path, help='New output directory; existing data is not overwritten')
    parser.add_argument('--lua', default='lua')
    parser.add_argument('--archive', type=Path, help='Optional downloaded archive, for provenance SHA-256')
    args = parser.parse_args()
    root = args.data_root.resolve()
    output = args.output.resolve()
    if output.exists():
        parser.error('Output already exists; choose a new directory to review changes first')
    version = json.loads((root / 'base/info.json').read_text())['version']
    for pack in PACKS['space-age'][1:]:
        if json.loads((root / pack / 'info.json').read_text())['version'] != version:
            parser.error('Data pack version mismatch: ' + pack)
    loader = Path(__file__).with_name('load-data.lua')
    metadata = {
        'schemaVersion': 1, 'gameVersion': version, 'extraction': 'official-lua-data-stages',
        'engineValidation': False,
        'tableTraversal': 'sorted-snapshot',
        'builderSha256': digest(Path(__file__)), 'loaderSha256': digest(loader),
        'source': 'https://factorio.com/get-download/' + version + '/headless/linux64',
        'archiveSha256': digest(args.archive) if args.archive else None,
        'profiles': {}, 'iconFiles': {'referenced': 0, 'copied': 0, 'missing': []},
    }
    profile_ids = {}
    icon_files = set()
    with tempfile.TemporaryDirectory(prefix='f-logic-catalog-') as tmp:
        for profile, packs in PACKS.items():
            raw_path = Path(tmp) / (profile + '.json')
            subprocess.run([args.lua, str(loader), str(root), profile, str(raw_path), version], check=True)
            raw = json.loads(raw_path.read_text())
            en = Catalog(raw, locales(root, packs, 'en'))
            ru = Catalog(raw, locales(root, packs, 'ru'))
            counts, hidden, parameters, unresolved = {}, {}, {}, {}
            all_rows = []
            for kind, filename in FILES.items():
                rows = en.records(kind, ru)
                write_json(output / profile / (filename + '.json'), rows, records=True)
                all_rows.extend(rows)
                counts[kind] = len(rows)
                hidden[kind] = sum(r['hidden'] for r in rows)
                parameters[kind] = sum(r['parameter'] for r in rows)
                unresolved[kind] = [r['name'] for r in rows if r['labelSource']['ru'] == 'unresolved']
                for row in rows:
                    for layer in (row['icon'] or {}).get('layers', []):
                        icon_files.add(layer['icon'])
            groups = {
                'groups': list(raw.get('item-group', {}).values()),
                'subgroups': list(raw.get('item-subgroup', {}).values()),
            }
            for value in groups.values():
                value.sort(key=lambda r: (r.get('order', ''), r['name']))
            write_json(output / profile / 'groups.json', groups)
            profile_ids[profile] = {row['id'] for row in all_rows}
            metadata['profiles'][profile] = {'packs': packs, 'counts': counts, 'hidden': hidden, 'blueprintParameters': parameters, 'unresolvedRuLabels': unresolved}
    for original in sorted(icon_files):
        match = re.fullmatch(r'__(core|base|space-age|quality|recycler|elevated-rails)__/(.+)', original)
        if not match:
            raise ValueError('Unsupported icon path: ' + original)
        pack, rel = match.groups()
        source = root / pack / rel
        if not source.resolve().is_relative_to(root):
            raise ValueError('Icon path escapes data root')
        if source.is_file():
            target = output / 'icons' / pack / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            metadata['iconFiles']['copied'] += 1
        else:
            metadata['iconFiles']['missing'].append(original)
    metadata['iconFiles']['referenced'] = len(icon_files)
    specials = []
    for name, alias in LOGIC.items():
        specials.append({
            'id': 'virtual/' + name, 'name': name, 'alias': alias,
            'kind': 'logic-selector', 'transmittable': False,
            'profiles': ['base', 'space-age'],
        })
    specials.append({'id': 'virtual/signal-any-quality', 'name': 'signal-any-quality',
        'alias': 'Any quality', 'kind': 'quality-selector', 'profiles': ['space-age'],
        'transmittable': None, 'note': 'Context-specific quality selector; ordinary-channel use is not engine-validated.'})
    write_json(output / 'special-signals.json', specials)
    metadata['spaceAgeAddedIds'] = sorted(profile_ids['space-age'] - profile_ids['base'])
    metadata['spaceAgeRemovedIds'] = sorted(profile_ids['base'] - profile_ids['space-age'])
    write_json(output / 'manifest.json', metadata)
    print(json.dumps({'version': version, 'counts': {p: v['counts'] for p, v in metadata['profiles'].items()}, 'icons': {k: v for k, v in metadata['iconFiles'].items() if k != 'missing'}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
