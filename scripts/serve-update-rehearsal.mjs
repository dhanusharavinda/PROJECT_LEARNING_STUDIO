/** Serve only verified isolated update assets on loopback. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../work/updater-proof");
const proof = JSON.parse(fs.readFileSync(path.join(root, "new/verified.json"), "utf8"));
assert.equal(proof.identity.appId, "com.synapse.learningstudio.updatetest");
const installer = path.basename(proof.installer);
assert.equal(createHash("sha256").update(fs.readFileSync(proof.installer)).digest("hex"), proof.installerSha256);
const allowed = new Map([["latest.yml", path.join(root, "new/latest.yml")], [installer, proof.installer], [`${installer}.blockmap`, `${proof.installer}.blockmap`]]);
// Differential update may ask for the old blockmap. Supply only this same test identity.
const old = JSON.parse(fs.readFileSync(path.join(root, "old/verified.json"), "utf8"));
allowed.set(`${path.basename(old.installer)}.blockmap`, `${old.installer}.blockmap`);
const server = http.createServer((req, res) => {
	let name; try { name = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).slice(1); } catch { res.writeHead(400).end(); return; }
	const filename = allowed.get(name);
	if (!filename || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404).end(); return; }
	const size = fs.statSync(filename).size;
	let start = 0; let end = size - 1; let status = 200;
	if (req.headers.range) {
		const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
		if (!match) { res.writeHead(416).end(); return; }
		start = Number(match[1]); end = match[2] ? Number(match[2]) : end; status = 206;
		if (start > end || end >= size) { res.writeHead(416).end(); return; }
	}
	fs.appendFileSync(path.join(root, "feed-requests.jsonl"), JSON.stringify({ time: new Date().toISOString(), name, status, start, end }) + "\n");
	res.writeHead(status, { "Content-Type": name.endsWith(".yml") ? "text/yaml" : "application/octet-stream", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
	if (req.method === "HEAD") res.end(); else fs.createReadStream(filename, { start, end }).pipe(res);
});
server.listen(18767, "127.0.0.1", () => console.log("Isolated updater feed ready at http://127.0.0.1:18767/"));
