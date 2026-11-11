// A single, local-only Python worker. All runtime/package URLs are self-hosted.
let initialization;
let queue = Promise.resolve();

async function initialize() {
  const base = new URL('../vendor/solar/', import.meta.url);
  const {loadPyodide} = await import(new URL('pyodide.mjs', base).href);
  const manifestResponse = await fetch(new URL('manifest.json', base));
  if (!manifestResponse.ok) throw new Error('日射計算の配布ファイルがありません');
  const manifest = await manifestResponse.json();
  const python = await loadPyodide({indexURL: base.href});
  await python.loadPackage(manifest.packages);
  const wheel = new URL(manifest.wheel, base).href;
  python.globals.set('_solar_wheel', wheel);
  await python.runPythonAsync('import micropip\nawait micropip.install(_solar_wheel, deps=False)');
  const response = await fetch(new URL('engine.py?v=20261028a', import.meta.url));
  if (!response.ok) throw new Error('日射計算プログラムを読み込めませんでした');
  await python.runPythonAsync(await response.text());
  return python;
}

self.onmessage = ({data}) => {
  queue = queue.catch(() => {}).then(async () => {
    const started = performance.now();
    try {
      const python = await (initialization ||= initialize().catch(error => {
        initialization = null;
        throw error;
      }));
      python.globals.set('_solar_payload', JSON.stringify(data.payload));
      const result = JSON.parse(python.runPython('handle_json(_solar_payload)'));
      self.postMessage({id: data.id, result, elapsedMs: performance.now() - started});
    } catch (error) {
      self.postMessage({id: data.id, error: String(error.message || error)});
    }
  });
};
