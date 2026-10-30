import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { beginDesktopWork, DesktopUpdatePendingError, prepareDesktopUpdate, releaseDesktopUpdate, desktopUpdateReadinessResponse, UPDATE_PREPARE_TTL_MS } from "../src/server/update-admission.ts";

afterEach(() => releaseDesktopUpdate());

describe("desktop update work admission", () => {
	it("every active reservation blocks preparation until its own idempotent completion", () => {
		const lesson = beginDesktopWork("lesson"); const render = beginDesktopWork("render");
		try {
			assert.deepEqual(prepareDesktopUpdate(), { ready: false, reason: "busy" });
			lesson(); lesson();
			assert.deepEqual(prepareDesktopUpdate(), { ready: false, reason: "busy" });
			render(); assert.deepEqual(prepareDesktopUpdate(), { ready: true });
			assert.throws(() => beginDesktopWork("lab"), DesktopUpdatePendingError);
		} finally { lesson(); render(); }
	});

	it("prepare closes admission synchronously and release permits another job", () => {
		assert.deepEqual(prepareDesktopUpdate(), { ready: true });
		for (const kind of ["lesson", "background-job", "notes-import", "compaction", "lab"]) {
			assert.throws(() => beginDesktopWork(kind), (error: unknown) => error instanceof DesktopUpdatePendingError && error.status === 409);
		}
		releaseDesktopUpdate(); const finish = beginDesktopWork("lesson"); finish();
	});

	it("an abandoned prepare expires, while active work never expires", () => {
		prepareDesktopUpdate(Date.now() - UPDATE_PREPARE_TTL_MS - 1);
		const finish = beginDesktopWork("slow-render");
		try { assert.deepEqual(prepareDesktopUpdate(Date.now() + 3_600_000), { ready: false, reason: "busy" }); }
		finally { finish(); }
	});
});

describe("desktop update readiness HTTP boundary", () => {
	const previousServer = process.env.LH_DESKTOP_SERVER;
	const previousSecret = process.env.LH_DESKTOP_API_SECRET;
	const token = "fixture-capability-".padEnd(64, "x");
	const request = (op: unknown, secret?: string) => new Request("http://127.0.0.1:9000/api/desktop/update-readiness", {
		method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-learnharness-desktop": secret } : {}) }, body: JSON.stringify(op),
	});
	afterEach(() => {
		if (previousServer === undefined) delete process.env.LH_DESKTOP_SERVER; else process.env.LH_DESKTOP_SERVER = previousServer;
		if (previousSecret === undefined) delete process.env.LH_DESKTOP_API_SECRET; else process.env.LH_DESKTOP_API_SECRET = previousSecret;
	});
	it("requires the desktop mode and capability, never exposing this lock in browser mode", async () => {
		delete process.env.LH_DESKTOP_SERVER; delete process.env.LH_DESKTOP_API_SECRET;
		assert.equal((await desktopUpdateReadinessResponse(request({ op: "prepare" }))).status, 403);
		process.env.LH_DESKTOP_SERVER = "1"; process.env.LH_DESKTOP_API_SECRET = token;
		assert.equal((await desktopUpdateReadinessResponse(request({ op: "prepare" }))).status, 403);
		assert.equal((await desktopUpdateReadinessResponse(request({ op: "prepare" }, "wrong"))).status, 403);
		const finish = beginDesktopWork("lesson"); finish();
	});
	it("returns busy without locking, and accepts only prepare/release", async () => {
		process.env.LH_DESKTOP_SERVER = "1"; process.env.LH_DESKTOP_API_SECRET = token;
		const finish = beginDesktopWork("lesson");
		try { assert.deepEqual(await (await desktopUpdateReadinessResponse(request({ op: "prepare" }, token))).json(), { ready: false, reason: "busy" }); }
		finally { finish(); }
		assert.deepEqual(await (await desktopUpdateReadinessResponse(request({ op: "prepare" }, token))).json(), { ready: true });
		assert.throws(() => beginDesktopWork("render"), DesktopUpdatePendingError);
		assert.equal((await desktopUpdateReadinessResponse(request({ op: "install" }, token))).status, 400);
		assert.equal((await desktopUpdateReadinessResponse(request(null, token))).status, 400);
		assert.deepEqual(await (await desktopUpdateReadinessResponse(request({ op: "release" }, token))).json(), { ready: false, released: true });
		const next = beginDesktopWork("render"); next();
	});
});
