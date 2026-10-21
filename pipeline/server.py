"""Loopback-only HTTP service. Run through start_pipeline.py."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import threading
import uuid
import webbrowser
from contextlib import closing
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit
from . import geometry, energy, cfd, idf

ROOT=Path(__file__).resolve().parents[1]
RUNS=ROOT/'out_pipeline'
JOBS={}
LOCK=threading.RLock()
TOKEN=secrets.token_urlsafe(32)
EP=Path(os.environ.get('BOUNDARY_ENERGYPLUS',r'C:\EnergyPlusV24-2-0\energyplus.exe'))


def write_json(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')


def public(job):
    return {k:v for k,v in job.items() if k not in ('process','model')}


def persist(job):
    write_json(RUNS/job['id']/'status.json',public(job))


def get_job(jid):
    if not re.fullmatch(r'[a-f0-9]{32}',jid): raise ValueError('不正な実行IDです')
    with LOCK:
        if jid in JOBS: return JOBS[jid]
        folder=RUNS/jid
        if not (folder/'status.json').exists(): raise ValueError('実行結果が見つかりません')
        job=json.loads((folder/'status.json').read_text(encoding='utf-8'))
        job['model']=json.loads((folder/'building.json').read_text(encoding='utf-8'))
        if job['status'] in ('queued','running'):
            job.update(status='failed',message='ローカルサービスが終了したため、再実行が必要です')
        JOBS[jid]=job
        return job


class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def allowed(self,token=False):
        host=self.headers.get('Host','')
        expected=f'127.0.0.1:{self.server.server_port}'
        if host!=expected: return False
        origin=self.headers.get('Origin')
        if origin and origin!='http://'+expected: return False
        return not token or secrets.compare_digest(self.headers.get('X-Boundary-Token',''),TOKEN)

    def send(self,value,status=200,content_type='application/json; charset=utf-8'):
        data=value if isinstance(value,bytes) else json.dumps(value,ensure_ascii=False,allow_nan=False).encode('utf-8')
        self.send_response(status); self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff'); self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if not self.allowed(): return self.send({'error':'localhost only'},403)
        path=urlsplit(self.path).path
        try:
            if path=='/api/health': return self.send({'token':TOKEN,'workflow':'manual-energyplus','defaults':energy.defaults()})
            if path.startswith('/api/jobs/'):
                if not self.allowed(True): return self.send({'error':'token required'},403)
                parts=path.split('/'); job=get_job(parts[3]); folder=RUNS/job['id']
                if len(parts)==4: return self.send(public(job))
                if len(parts)==5 and parts[4]=='idf':
                    return self.send((folder/'model.idf').read_bytes(),content_type='text/plain; charset=utf-8')
                if len(parts)==5 and parts[4]=='result':
                    if job['status']!='complete': raise ValueError('計算が完了していません')
                    return self.send((folder/'result.json').read_bytes())
                if len(parts)==5 and parts[4]=='artifacts':
                    import io,zipfile
                    stream=io.BytesIO()
                    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:
                        for p in folder.rglob('*'):
                            if p.is_file(): z.write(p,p.relative_to(folder).as_posix())
                    return self.send(stream.getvalue(),content_type='application/zip')
                raise ValueError('APIが見つかりません')
            resolved=Path(self.translate_path(path)).resolve()
            rel=resolved.relative_to(ROOT).parts
            if any(x.startswith('.') for x in rel) or (rel and rel[0] in ('pipeline','out_pipeline','tests')):
                return self.send({'error':'not served'},403)
            if resolved.is_dir() and path!='/': return self.send({'error':'directory listing disabled'},403)
            return super().do_GET()
        except (ValueError,KeyError,IndexError) as e: self.send({'error':str(e)},400)

    def do_HEAD(self):
        self.send_error(405,'HEAD is not supported')

    def do_POST(self):
        if not self.allowed(True): return self.send({'error':'local session token required'},403)
        try:
            size=int(self.headers.get('Content-Length','0'))
            path=urlsplit(self.path).path
            if re.fullmatch(r'/api/jobs/[a-f0-9]{32}/sql',path):
                if not 0<size<=512_000_000: raise ValueError('SQLは512MB以下を指定してください')
                job=get_job(path.split('/')[3])
                if job.get('mode')!='manual': raise ValueError('先にIDFを作成してください')
                folder=RUNS/job['id']; temp=folder/('import-'+uuid.uuid4().hex+'.sql')
                try:
                    with temp.open('wb') as stream:
                        remaining=size
                        while remaining:
                            chunk=self.rfile.read(min(remaining,1024*1024))
                            if not chunk: raise ValueError('SQLの送信が途中で終了しました')
                            stream.write(chunk); remaining-=len(chunk)
                    with closing(sqlite3.connect(temp)) as db:
                        version=db.execute('SELECT EnergyPlusVersion FROM Simulations').fetchone()
                        if not version or not re.search(r'\b24\.2\.',version[0]):
                            raise ValueError('EnergyPlus 24.2のSQLを指定してください')
                    mapping=json.loads((folder/'mapping.json').read_text(encoding='utf-8'))
                    result=energy.extract(temp,mapping,job['model'])
                    if len(result['times'])!=8760:
                        raise ValueError('このIDFの年間8760時間のSQLを指定してください')
                    with LOCK:
                        temp.replace(folder/'eplusout.sql')
                        write_json(folder/'result.json',result)
                        job.update(status='complete',message='手動実行したSQLを取り込みました'); persist(job)
                    return self.send(public(job))
                finally:
                    temp.unlink(missing_ok=True)
            if not 0<size<=80_000_000: raise ValueError('リクエストサイズが不正です')
            data=json.loads(self.rfile.read(size))
            if path=='/api/shutdown':
                self.send({'message':'入力作成サービスを終了しました'})
                threading.Thread(target=self.server.shutdown,daemon=True).start()
                return
            if path=='/api/validate':
                return self.send(geometry.validate(data['model'],data.get('thermal',False)))
            if path=='/api/pair': return self.send({'model':geometry.pair_adjacent(data['model'])})
            if path=='/api/prepare':
                ep,mapping,model=energy.build(data['model'])
                text=idf.serialize(ep)
                jid=uuid.uuid4().hex; folder=RUNS/jid; folder.mkdir(parents=True)
                (folder/'model.idf').write_text(text,encoding='utf-8')
                write_json(folder/'model.epJSON',ep); write_json(folder/'mapping.json',mapping); write_json(folder/'building.json',model)
                (folder/'実行手順.txt').write_text('EnergyPlus 24.2のEP-Launchでmodel.idfと年間EPWを選んで実行してください。\n'
                    'ツールはEnergyPlusを実行しません。SQLはEnergyPlus側で生成します。\n'
                    'eplusout.errにSevere/Fatalがないことと正常終了を確認してください。\n'
                    '同じIDFの結果であることを確認して、画面04からeplusout.sqlを取り込んでください。\n'
                    'SQL単独では材料・設定・気象の一致を証明できません。入力IDF・EPW・ログも一緒に保管してください。\n',encoding='utf-8')
                job={'id':jid,'status':'prepared','mode':'manual','fingerprint':mapping['fingerprint'],'message':'IDF作成済み。EnergyPlusを手動実行してください','model':model}
                with LOCK:
                    JOBS[jid]=job; persist(job)
                return self.send(public(job),201)
            if path=='/api/jobs':
                return self.send({'error':'自動実行は停止しました。IDFを保存し、EnergyPlusを手動実行してください'},400)
            if path.startswith('/api/jobs/'):
                parts=path.split('/'); job=get_job(parts[3]); action=parts[4]
                if action=='cancel':
                    with LOCK:
                        if job['status'] in ('queued','running'):
                            job['status']='cancelled'; job['message']='中止しました'
                            if job.get('process'): job['process'].terminate()
                            persist(job)
                    return self.send(public(job))
                if action=='export':
                    if job['status']!='complete': raise ValueError('計算が完了していません')
                    current=geometry.normalize(data['model'])
                    if geometry.fingerprint(current)!=job['fingerprint']:
                        raise ValueError('入力変更のため再計算が必要です')
                    result=json.loads((RUNS/job['id']/'result.json').read_text(encoding='utf-8'))
                    return self.send(cfd.export_bundle(current,result,int(data['index']),data.get('flows',{}),data.get('categoryCsv','')),content_type='application/zip')
            raise ValueError('APIが見つかりません')
        except (ValueError,KeyError,TypeError,IndexError) as e: self.send({'error':str(e)},400)
        except Exception as e: self.send({'error':'処理に失敗しました: '+str(e)},500)


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8766); parser.add_argument('--no-browser',action='store_true'); args=parser.parse_args()
    RUNS.mkdir(exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    url=f'http://127.0.0.1:{server.server_port}/'
    print('Boundary Tool: '+url,flush=True)
    if not args.no_browser: webbrowser.open(url)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        with LOCK:
            for job in JOBS.values():
                if job.get('process') and job['process'].poll() is None:
                    job['process'].terminate(); job['status']='cancelled'; persist(job)
        server.server_close()
