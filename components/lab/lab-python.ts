import type { LabCodeTest } from '../../src/core/index.ts';

export interface LabPythonResult {
  results: { testId: string; actual?: unknown; error?: string }[];
  stdout: string;
  durationMs: number;
  error?: string;
}
export interface LabPythonInput {
  code: string;
  entrypoint: string;
  tests: LabCodeTest[];
  signal?: AbortSignal;
  onOutput?: (text: string) => void;
}
const files = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
let cachedAssets: Promise<{ assets: Record<string, ArrayBuffer>; workerSource: string }> | undefined;
function loadAssets() {
  return cachedAssets ??= (async () => {
    const signal = AbortSignal.timeout(15000);
    const assets: Record<string, ArrayBuffer> = {};
    await Promise.all(files.map(async file => {
      const response = await fetch(`/lab/python/${file}`, { cache: 'force-cache', signal });
      if (!response.ok) throw new Error('Python runtime is missing. Reinstall this Learning Studio version.');
      assets[file] = await response.arrayBuffer();
    }));
    const response = await fetch('/lab/python-worker.mjs', { signal });
    if (!response.ok) throw new Error('Python worker could not load.');
    return { assets, workerSource: await response.text() };
  })().catch(error => { cachedAssets = undefined; throw error; });
}

async function prepare(signal?: AbortSignal) {
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([loadAssets(), new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException('Run cancelled.', 'AbortError'));
      signal?.addEventListener('abort', cancel, { once: true });
    })]);
  } finally { if (cancel) signal?.removeEventListener('abort', cancel); }
}

/** Each run gets a disposable opaque-origin iframe and dedicated worker. */
export async function runLabPython(input: LabPythonInput): Promise<LabPythonResult> {
  if (input.signal?.aborted) throw new DOMException('Run cancelled.', 'AbortError');
  if (input.code.length > 100000 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.entrypoint) || input.tests.length > 50) throw new Error('Invalid exercise.');
  const runtime = await prepare(input.signal);
  if (input.signal?.aborted) throw new DOMException('Run cancelled.', 'AbortError');
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Isolated Python worker';
    frame.sandbox.add('allow-scripts');
    const token = crypto.randomUUID();
    const started = performance.now();
    let initialized = false;
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); input.signal?.removeEventListener('abort', abort); frame.remove(); };
    const abort = () => { cleanup(); reject(new DOMException('Run cancelled.', 'AbortError')); };
    const timeout = setTimeout(() => {
      cleanup(); resolve({ results: [], stdout: '', durationMs: Math.round(performance.now() - started), error: 'Execution stopped after 30 seconds. Check for an infinite loop or reduce the work.' });
    }, 30000);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return;
      const data = event.data;
      if (data?.type === 'lab-ready' && !initialized) {
        initialized = true;
        frame.contentWindow?.postMessage({ type: 'lab-init', token, ...runtime, code: input.code, entrypoint: input.entrypoint, tests: input.tests.map(({ id, args }) => ({ id, args })) }, '*');
      } else if (data?.token === token && data.type === 'output' && typeof data.text === 'string') {
        input.onOutput?.(data.text.slice(0, 20000));
      } else if (data?.token === token && data.type === 'result' && Array.isArray(data.results)) {
        cleanup(); resolve({ results: data.results.slice(0, 50), stdout: String(data.stdout || '').slice(0, 20000), durationMs: Math.round(performance.now() - started), ...(data.error ? { error: String(data.error).slice(0, 3000) } : {}) });
      }
    };
    window.addEventListener('message', receive);
    input.signal?.addEventListener('abort', abort, { once: true });
    frame.src = '/lab/python-sandbox.html';
    document.body.append(frame);
  });
}
