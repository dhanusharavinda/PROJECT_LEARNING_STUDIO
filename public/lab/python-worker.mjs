/* No host Python, network packages, persistence, or credentials enter this worker. */
const send = self.postMessage.bind(self);
self.onmessage = async event => {
  self.onmessage = null;
  const { assets, code, entrypoint, tests } = event.data;
  const started = performance.now();
  const localFetch = self.fetch.bind(self);
  // Pyodide owns instantiateWasm, including its JS exception imports. Supply
  // its exact bundled binary request from memory instead of replacing that hook.
  self.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://offline.invalid/pyodide.asm.wasm') {
      return new Response(assets['pyodide.asm.wasm'], { headers: { 'Content-Type': 'application/wasm' } });
    }
    if (url.startsWith('blob:')) return localFetch(input, init);
    throw new Error('This exercise uses the bundled Python standard library. Network requests are disabled.');
  };
  let stdout = '';
  const output = text => {
    if (stdout.length >= 20000) return;
    const line = `${text}\n`.slice(0, 20000 - stdout.length);
    stdout += line;
    send({ type: 'output', text: line });
  };
  const urls = [];
  const blob = (data, type = 'text/javascript') => {
    const url = URL.createObjectURL(new Blob([data], { type })); urls.push(url); return url;
  };
  const results = [];
  try {
    const { loadPyodide } = await import(blob(assets['pyodide.mjs']));
    const { default: createPyodideModule } = await import(blob(assets['pyodide.asm.mjs']));
    const py = await loadPyodide({
      indexURL: 'https://offline.invalid/',
      stdLibURL: blob(assets['python_stdlib.zip'], 'application/zip'),
      lockFileContents: new TextDecoder().decode(assets['pyodide-lock.json']),
      packageBaseUrl: 'https://offline.invalid/',
      createPyodideModule,
      jsglobals: Object.freeze({}),
      convertNullToNone: true,
      stdout: output, stderr: output, stdin: () => null,
    });
    const namespace = py.toPy({});
    try {
      py.runPython(code, { globals: namespace });
      const fn = namespace.get(entrypoint);
      if (typeof fn !== 'function') throw new Error(`Define a function named ${entrypoint}.`);
      try {
        for (const test of tests) {
          const args = test.args.map(arg => py.toPy(arg));
          let value;
          try {
            value = fn(...args);
            const actual = value?.toJs ? value.toJs({ dict_converter: Object.fromEntries }) : value;
            const encoded = JSON.stringify(actual ?? null);
            if (encoded.length > 30000) throw new Error('Result is too large. Return only the requested answer.');
            results.push({ testId: test.id, actual: JSON.parse(encoded) });
          } catch (error) { results.push({ testId: test.id, error: String(error.message || error).slice(0, 3000) }); }
          finally { value?.destroy?.(); for (const arg of args) arg?.destroy?.(); }
        }
      } finally { fn.destroy?.(); }
    } finally { namespace.destroy(); }
    send({ type: 'result', results, stdout, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    send({ type: 'result', results, stdout, durationMs: Math.round(performance.now() - started), error: String(error.message || error).slice(0, 3000) });
  } finally { for (const url of urls) URL.revokeObjectURL(url); self.close(); }
};
