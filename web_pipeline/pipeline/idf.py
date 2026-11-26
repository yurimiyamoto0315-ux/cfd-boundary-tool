"""Serialize the supported epJSON objects without installing or running EnergyPlus.

Field order/defaults are derived from EnergyPlus 24.2's official schema.
See EnergyPlus-LICENSE.txt. Reject unknown fields rather than silently losing data.
"""
import json
import math
from pathlib import Path

LAYOUT = json.loads(Path(__file__).with_name('idf-layout-24.2.json').read_text(encoding='utf-8'))


def serialize(ep):
    def value(v):
        if isinstance(v, float) and not math.isfinite(v):
            raise ValueError('IDFに非有限の数値は書き出せません')
        text = str(v)
        if any(c in text for c in ',;!\r\n\t'):
            raise ValueError('IDFの名称に区切り文字・改行は使えません: '+repr(text))
        return text

    blocks = ['! Boundary Tool / EnergyPlus 24.2 / annual weather run']
    for kind, objects in ep.items():
        if kind not in LAYOUT:
            raise ValueError('未対応のIDFオブジェクト: '+kind)
        layout = LAYOUT[kind]
        fields, extension = layout['fields'], layout.get('extension')
        for name, raw in objects.items():
            data = dict(raw)
            if 'name' in fields:
                data['name'] = name
            unknown = set(data)-set(fields)-({extension} if extension else set())
            if unknown:
                raise ValueError(kind+': 未対応のフィールド '+str(sorted(unknown)))
            if extension == 'vertices':
                data['number_of_vertices'] = len(data[extension])
            pairs = [(f, data.get(f, layout['defaults'].get(f, ''))) for f in fields]
            if extension:
                for row in data.get(extension, []):
                    if set(row)-set(layout['extensibles']):
                        raise ValueError(kind+': 未対応の拡張フィールド')
                    pairs.extend((f, row.get(f, '')) for f in layout['extensibles'])
            # Keep interior blanks (they are positional), omit trailing empty fields.
            while pairs and pairs[-1][1] == '':
                pairs.pop()
            if not pairs:
                pairs = [('name', name)]
            blocks.append(kind+',\n'+ '\n'.join(
                '  '+value(v)+(';' if i == len(pairs)-1 else ',')+'  !- '+f
                for i, (f, v) in enumerate(pairs)))
    return '\n\n'.join(blocks)+'\n'
