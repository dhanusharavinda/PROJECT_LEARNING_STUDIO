import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const workerSource = readFileSync(new URL("../public/lab/python-worker.mjs", import.meta.url), "utf8");
const frameSource = readFileSync(new URL("../public/lab/python-sandbox.html", import.meta.url), "utf8");
const parentSource = readFileSync(new URL("../components/lab/lab-python.ts", import.meta.url), "utf8");

test("worker supplies the exact bundled binary but refuses app and cloud network access", async () => {
	const delegated: unknown[] = [], messages: unknown[] = [];
	const self: {
		fetch: typeof fetch;
		postMessage: (value: unknown) => void;
		close: () => void;
		onmessage?: ((event: { data: unknown }) => Promise<void>) | null;
	} = {
		fetch: async (input) => { delegated.push(input); return new Response("blob fixture"); },
		postMessage: value => { messages.push(value); }, close: () => {},
	};
	const context = vm.createContext({ self, URL, Blob, Response, TextDecoder, performance, Uint8Array });
	// Exercise the shipped worker's policy. Stop at module loading so no host
	// Python, real network, or browser APIs are available to this unit test.
	new vm.Script(workerSource, { importModuleDynamically: async () => { throw new Error("Module loading belongs to the browser integration test."); } }).runInContext(context);
	await self.onmessage!({ data: { assets: { "pyodide.mjs": new ArrayBuffer(0), "pyodide.asm.wasm": new Uint8Array([0, 97, 115, 109]).buffer }, code: "", entrypoint: "solve", tests: [] } });
	assert(messages.length > 0);
	for (const url of ["https://example.com/", "http://127.0.0.1:4351/api/lab", "https://offline.invalid/package.whl", "file:///etc/passwd"]) {
		await assert.rejects(self.fetch(url), /Network requests are disabled/);
	}
	assert.deepEqual(delegated, []);
	const binary = await self.fetch("https://offline.invalid/pyodide.asm.wasm");
	assert.equal(binary.headers.get("content-type"), "application/wasm");
	assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 97, 115, 109]);
	assert.equal(delegated.length, 0);
	assert.equal(await (await self.fetch("blob:fixture")).text(), "blob fixture");
	assert.equal(delegated.length, 1);
});

test("sandbox keeps opaque origin, restricted CSP, and empty Python JavaScript globals", () => {
	assert.match(parentSource, /sandbox\.add\(['"]allow-scripts['"]\)/);
	assert(!parentSource.includes("allow-same-origin"));
	assert.match(frameSource, /default-src 'none'/);
	assert.match(frameSource, /connect-src blob:/);
	assert.match(frameSource, /worker-src blob:/);
	assert(!/script-src[^;]*'unsafe-eval'/.test(frameSource));
	assert.match(workerSource, /jsglobals:\s*Object\.freeze\(\{\}\)/);
	assert.match(parentSource, /event\.source !== frame\.contentWindow/);
	assert.match(parentSource, /event\.origin !== 'null'/);
});
