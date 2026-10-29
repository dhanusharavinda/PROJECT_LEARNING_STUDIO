import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { terminateWindowsTree } = require("../electron/owned-process.cjs");

test("shutdown addresses only a numeric owned PID, without a shell or image-wide kill", () => {
	const calls: unknown[][] = [];
	terminateWindowsTree({ pid: 12345, exitCode: null, signalCode: null }, (...args: unknown[]) => calls.push(args));
	assert.deepEqual(calls[0]![1], ["/PID", "12345", "/T", "/F"]);
	assert.deepEqual(calls[0]![2], { windowsHide: true, timeout: 10000, stdio: "ignore" });
	assert.throws(() => terminateWindowsTree({ pid: "123 & calc" }, () => assert.fail("must not execute")));
	terminateWindowsTree({ pid: 12345, exitCode: 0 }, () => assert.fail("already exited"));
});

test("Windows shutdown removes an owned server subtree and preserves an unrelated process", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
	const parentCode = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});process.send({pid:c.pid});setTimeout(()=>{},30000);`;
	const parent = spawn(process.execPath, ["-e", parentCode], { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
	const unrelated = spawn(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { stdio: "ignore", windowsHide: true });
	let worker = 0;
	try {
		const [ready] = await once(parent, "message");
		worker = ready.pid;
		assert.ok(worker > 0 && parent.pid && unrelated.pid);
		const stopped = once(parent, "exit");
		terminateWindowsTree(parent);
		await stopped;
		let alive = true;
		for (let attempt = 0; attempt < 30 && alive; attempt++) {
			try { process.kill(worker, 0); await new Promise(resolve => setTimeout(resolve, 100)); }
			catch { alive = false; }
		}
		assert.equal(alive, false, "worker must not survive its server");
		assert.equal(unrelated.exitCode, null);
		assert.doesNotThrow(() => process.kill(unrelated.pid!, 0));
	} finally {
		if (parent.exitCode === null) terminateWindowsTree(parent);
		unrelated.kill();

	}
});
