# Lab runtime notices

Learning Studio's original Lab code and curriculum are part of this AGPL-3.0-only repository. The lesson texts, tests, prompts and UI implementation were authored for this project. Linked third-party resources remain on their publishers' sites and retain their own terms.

The bundled browser interpreter is [Pyodide 314.0.7](https://github.com/pyodide/pyodide/tree/314.0.7), with Python 3.14.2. The installer contains its unmodified JavaScript, WebAssembly and standard-library assets from the pinned npm package. `scripts/prepare-lab-python.mjs` reproduces those assets. Source is available from the linked upstream projects and the exact package version in `package-lock.json`.

- [Pyodide MPL-2.0 notice](licenses/Pyodide-MPL-2.0.txt)
- [Python 3.14.2 license and notices](licenses/Python-3.14.2.txt)
- [CodeMirror MIT notice](licenses/CodeMirror-MIT.txt), source at [CodeMirror](https://github.com/codemirror)
- [React CodeMirror MIT notice](licenses/react-codemirror-MIT.txt), source at [uiwjs/react-codemirror](https://github.com/uiwjs/react-codemirror)

These notices are included in the Windows payload under `resources/licenses/lab`. The separate ManimGX portable runtime retains its own distribution notices. See [Learning Studio attribution](learning-studio.md#attribution-and-licenses) and the repository LICENSE for the broader application.
