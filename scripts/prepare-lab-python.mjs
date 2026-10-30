import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dest = resolve(root, 'public/lab/python');
await mkdir(dest, { recursive: true });
for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await copyFile(resolve(root, 'node_modules/pyodide', file), resolve(dest, file));
}
const { version } = JSON.parse(await readFile(resolve(root, 'node_modules/pyodide/package.json'), 'utf8'));
await writeFile(resolve(dest, 'version.json'), JSON.stringify({ version }));
console.log(`Bundled offline Lab Python ${version}`);
