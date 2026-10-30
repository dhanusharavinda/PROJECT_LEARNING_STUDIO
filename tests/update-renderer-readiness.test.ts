import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { beforeRestart, isUpdatePreparing, registerUpdateGuard, subscribeUpdatePreparing } from "../components/update-readiness.ts";

test("restart freezes edits before waiting for draft saves, blocks duplicate restart and releases input", async () => {
	const dom = parseHTML("<html><body></body></html>"); Object.assign(globalThis, { document: dom.document });
	let complete!: () => void; const saved = new Promise<void>(resolve => { complete = resolve; });
	const states: boolean[] = []; const off = subscribeUpdatePreparing(() => states.push(isUpdatePreparing()));
	const remove = registerUpdateGuard(async () => { assert.equal(isUpdatePreparing(), true); assert.equal(document.body.inert, true); await saved; });
	try {
		const pending = beforeRestart(); assert.equal(isUpdatePreparing(), true);
		await assert.rejects(beforeRestart(), /already/);
		complete(); const release = await pending;
		assert.equal(document.body.inert, true); release(); release();
		assert.equal(document.body.inert, false); assert.deepEqual(states, [true, false]);
	} finally { remove(); off(); }
});

test("a failed save aborts preparation and restores input without running later guards", async () => {
	let later = false;
	const removeFailure = registerUpdateGuard(async () => { throw new Error("Save failed"); });
	const removeLater = registerUpdateGuard(async () => { later = true; });
	try {
		await assert.rejects(beforeRestart(), /Save failed/);
		assert.equal(later, false); assert.equal(isUpdatePreparing(), false); assert.equal(document.body.inert, false);
	} finally { removeFailure(); removeLater(); }
});
