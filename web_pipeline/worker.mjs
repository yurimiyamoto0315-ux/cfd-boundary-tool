// All calculation and job data stay in this browser. Only static program files
// and the pinned Python runtime are fetched from this site's own origin.
const VERSION = '20261126a';
const DATABASE = 'akl-browser-pipeline-v1';
const STORE = 'jobs';
const SQL_PATH = '/akl-temp/input.sql';
const OUTPUT_PATH = '/akl-temp/output.zip';
const PROGRAM_FILES = [
  'pipeline/__init__.py',
  'pipeline/geometry.py',
  'pipeline/energy.py',
  'pipeline/idf.py',
  'pipeline/idf-layout-24.2.json',
  'pipeline/cfd.py',
  'bridge.py',
];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('ブラウザの保存領域を開けません。保存設定と空き容量を確認してください。'));
    request.onblocked = () => reject(new Error('ブラウザの保存領域を開けません。他のタブを閉じて再度お試しください。'));
  });
}

function dbRequest(db, mode, operation) {
  return new Promise((resolve, reject) => {
    let result;
    let transaction;
    try {
      transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(new Error('ブラウザの保存領域を読み書きできません。空き容量を確認してください。'));
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(new Error('ブラウザの保存領域を読み書きできません。空き容量を確認してください。'));
    transaction.onabort = () => reject(new Error('ブラウザへの保存が中断されました。空き容量を確認してください。'));
  });
}

async function getJob(db, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) {
    throw new Error('不正な実行IDです');
  }
  const job = await dbRequest(db, 'readonly', store => store.get(id));
  if (!job) throw new Error('保存した実行結果が見つかりません。IDFを再作成してください。');
  return job;
}

function updateJob(db, id, changes) {
  // One read-write transaction avoids overwriting unrelated updates from
  // another tab that is open to the same saved job.
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(id);
    let updated;
    request.onsuccess = () => {
      if (!request.result) {
        transaction.abort();
        return;
      }
      updated = Object.assign(request.result, changes);
      store.put(updated);
    };
    transaction.oncomplete = () => resolve(updated);
    transaction.onerror = () => reject(new Error('ブラウザの保存領域へ保存できません。空き容量を確認してください。'));
    transaction.onabort = () => reject(new Error('保存した実行結果が見つからないか、保存に失敗しました。'));
  });
}

function publicJob(job) {
  return {id: job.id, status: job.status, mode: job.mode,
          fingerprint: job.fingerprint, message: job.message};
}

function newId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function sourceUrl(path) {
  const url = new URL(path, import.meta.url);
  url.searchParams.set('v', VERSION);
  return url;
}

async function initialize() {
  const db = await openDatabase();
  const base = new URL('../vendor/solar/', import.meta.url);
  const {loadPyodide} = await import(new URL('pyodide.mjs', base).href);
  const python = await loadPyodide({indexURL: base.href});
  await python.loadPackage(['numpy', 'shapely']);
  python.FS.mkdirTree('/akl/pipeline');
  python.FS.mkdirTree('/akl-temp');
  const contents = await Promise.all(PROGRAM_FILES.map(async path => {
    const response = await fetch(sourceUrl(path));
    if (!response.ok) throw new Error('IDF作成プログラムを読み込めませんでした: ' + path);
    return response.text();
  }));
  PROGRAM_FILES.forEach((path, index) => python.FS.writeFile('/akl/' + path, contents[index], {encoding: 'utf8'}));
  python.runPython('import sys\nsys.path.insert(0, "/akl")\nimport bridge');
  return {db, python};
}

function callPython(python, request) {
  python.globals.set('_akl_request', JSON.stringify(request));
  return JSON.parse(python.runPython('bridge.handle_json(_akl_request)'));
}

function unlink(python, path) {
  try { python.FS.unlink(path); } catch (_) { /* The temporary file did not exist. */ }
}

async function writeBlob(python, path, blob) {
  try {
    const buffer = await blob.arrayBuffer();
    python.FS.writeFile(path, new Uint8Array(buffer));
  } catch (error) {
    throw new Error('SQLを読み込めませんでした。ブラウザの空きメモリとファイルを確認してください。');
  }
}

function outputBlob(python, type) {
  return new Blob([python.FS.readFile(OUTPUT_PATH)], {type});
}

async function dispatch(context, request) {
  const {db, python} = context;
  const action = request.action;
  if (action === 'health') return callPython(python, {action});
  if (action === 'validate') return callPython(python, {action, model: request.model, thermal: request.thermal});
  if (action === 'pair') return callPython(python, {action, model: request.model});

  if (action === 'prepare') {
    const data = callPython(python, {action, model: request.model});
    const job = {
      id: newId(), status: 'prepared', mode: 'manual', fingerprint: data.mapping.fingerprint,
      message: 'IDF作成済み。EnergyPlusを手動実行してください',
      model: data.model, ep: data.ep, mapping: data.mapping, idf: data.idf, result: null, sql: null,
    };
    await dbRequest(db, 'readwrite', store => store.add(job));
    return publicJob(job);
  }

  const job = await getJob(db, request.jobId);
  if (action === 'get_job') return publicJob(job);
  if (action === 'get_idf') return new Blob([job.idf], {type: 'text/plain; charset=utf-8'});
  if (action === 'get_result') {
    if (job.status !== 'complete' || job.result == null) throw new Error('計算が完了していません');
    return job.result;
  }

  if (action === 'sql_import') {
    const file = request.file;
    if (job.mode !== 'manual') throw new Error('先にIDFを作成してください');
    if (!(file instanceof Blob) || file.size <= 0 || file.size > 512000000) {
      throw new Error('SQLは512MB以下を指定してください');
    }
    try {
      await writeBlob(python, SQL_PATH, file);
      const result = callPython(python, {action, sqlPath: SQL_PATH, mapping: job.mapping, model: job.model});
      const updated = await updateJob(db, job.id, {
        status: 'complete', message: '手動実行したSQLを取り込みました', result, sql: file,
      });
      return publicJob(updated);
    } finally {
      unlink(python, SQL_PATH);
    }
  }

  if (action === 'get_artifacts') {
    try {
      if (job.sql) await writeBlob(python, SQL_PATH, job.sql);
      const {sql, ...serializable} = job;
      callPython(python, {action: 'artifacts', job: serializable, status: publicJob(job),
                          sqlPath: sql ? SQL_PATH : null, outputPath: OUTPUT_PATH});
      return outputBlob(python, 'application/zip');
    } finally {
      unlink(python, SQL_PATH);
      unlink(python, OUTPUT_PATH);
    }
  }

  if (action === 'cfd_export') {
    if (job.status !== 'complete' || job.result == null) throw new Error('計算が完了していません');
    try {
      callPython(python, {action, model: request.model, index: request.index,
                          flows: request.flows || {}, categoryCsv: request.categoryCsv || '',
                          fingerprint: job.fingerprint, result: job.result, outputPath: OUTPUT_PATH});
      return outputBlob(python, 'application/zip');
    } finally {
      unlink(python, OUTPUT_PATH);
    }
  }
  throw new Error('APIが見つかりません');
}

const initialization = initialize();
initialization.then(() => self.postMessage({type: 'ready'}), error => {
  self.postMessage({type: 'error', error: String(error.message || error)});
});
let queue = Promise.resolve();
self.onmessage = ({data}) => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      const result = await dispatch(await initialization, data);
      self.postMessage({id: data.id, ok: true, result});
    } catch (error) {
      self.postMessage({id: data.id, ok: false, error: String(error.message || error)});
    }
  });
};
