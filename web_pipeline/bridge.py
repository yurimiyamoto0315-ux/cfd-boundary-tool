"""Browser-local adapter around the same EnergyPlus input and CFD code as the server.

The JavaScript worker owns job persistence and provides temporary file paths.  This
module never starts EnergyPlus and never sends model or result data over a network.
"""
import json
import re
import sqlite3
import zipfile

from pipeline import cfd, energy, geometry, idf


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _instructions():
    return (
        'EnergyPlus 24.2のEP-Launchでmodel.idfと年間EPWを選んで実行してください。\n'
        'ツールはEnergyPlusを実行しません。SQLはEnergyPlus側で生成します。\n'
        'eplusout.errにSevere/Fatalがないことと正常終了を確認してください。\n'
        '同じIDFの結果であることを確認して、画面04からeplusout.sqlを取り込んでください。\n'
        'SQL単独では材料・設定・気象の一致を証明できません。入力IDF・EPW・ログも一緒に保管してください。\n'
    )


def handle_json(raw):
    request = json.loads(raw)
    action = request['action']

    if action == 'health':
        return _json({'token': 'browser-local', 'workflow': 'manual-energyplus',
                      'defaults': energy.defaults()})

    if action == 'validate':
        return _json(geometry.validate(request['model'], request.get('thermal', False)))

    if action == 'pair':
        return _json({'model': geometry.pair_adjacent(request['model'])})

    if action == 'prepare':
        ep, mapping, model = energy.build(request['model'])
        return _json({'model': model, 'ep': ep, 'mapping': mapping,
                      'idf': idf.serialize(ep)})

    if action == 'sql_import':
        path = request['sqlPath']
        with sqlite3.connect(path) as db:
            version = db.execute('SELECT EnergyPlusVersion FROM Simulations').fetchone()
        if not version or not re.search(r'\b24\.2\.', version[0]):
            raise ValueError('EnergyPlus 24.2のSQLを指定してください')
        result = energy.extract(path, request['mapping'], request['model'])
        if len(result['times']) != 8760:
            raise ValueError('このIDFの年間8760時間のSQLを指定してください')
        return _json(result)

    if action == 'cfd_export':
        model = geometry.normalize(request['model'])
        if geometry.fingerprint(model) != request['fingerprint']:
            raise ValueError('入力変更のため再計算が必要です')
        data = cfd.export_bundle(model, request['result'], int(request['index']),
                                 request.get('flows', {}), request.get('categoryCsv', ''))
        with open(request['outputPath'], 'wb') as output:
            output.write(data)
        return _json({'written': True})

    if action == 'artifacts':
        job = request['job']
        with zipfile.ZipFile(request['outputPath'], 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('model.idf', job['idf'].encode('utf-8'))
            for filename, value in (
                ('model.epJSON', job['ep']), ('mapping.json', job['mapping']),
                ('building.json', job['model']), ('status.json', request['status']),
            ):
                archive.writestr(filename, json.dumps(value, ensure_ascii=False,
                                                       indent=2, allow_nan=False).encode('utf-8'))
            archive.writestr('実行手順.txt', _instructions().encode('utf-8'))
            if job.get('result') is not None:
                archive.writestr('result.json', json.dumps(job['result'], ensure_ascii=False,
                                                           indent=2, allow_nan=False).encode('utf-8'))
            if request.get('sqlPath'):
                archive.write(request['sqlPath'], 'eplusout.sql')
        return _json({'written': True})

    raise ValueError('APIが見つかりません')
