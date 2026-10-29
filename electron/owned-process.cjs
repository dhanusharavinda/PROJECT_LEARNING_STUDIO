"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");

/** Called before terminating the server, while it still owns its worker subtree. */
function terminateWindowsTree(child, run = execFileSync) {
	if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error("Owned server PID is unavailable.");
	if (child.exitCode != null || child.signalCode != null) return;
	try {
		run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
			["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000, stdio: "ignore" });
	} catch (error) {
		// An exit racing with shutdown is already complete. Never kill by image name.
		if (child.exitCode != null || child.signalCode != null) return;
		try { process.kill(child.pid, 0); } catch (gone) { if (gone.code === "ESRCH") return; }
		throw error;
	}
}
module.exports = { terminateWindowsTree };
