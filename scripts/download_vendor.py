"""Pin the existing UI dependencies for reliable local operation."""
from pathlib import Path
import hashlib
import json
import urllib.request

root=Path(__file__).resolve().parents[1]/'vendor'
root.mkdir(exist_ok=True)
sources={
    'chart.umd-4.4.1.js':'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
    'pdf-3.11.174.js':'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'pdf.worker-3.11.174.js':'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
}
manifest={}
for name,url in sources.items():
    content=urllib.request.urlopen(url,timeout=60).read()
    (root/name).write_bytes(content)
    manifest[name]={'url':url,'sha256':hashlib.sha256(content).hexdigest()}
    print(name,len(content),flush=True)
(root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
