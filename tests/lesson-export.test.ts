import assert from "node:assert/strict";
import { test } from "node:test";
import { lessonExport } from "../src/core/lesson-export.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
test("lesson export contains readable text and safe portable filename", () => {
	const out = lessonExport({ title: '../RAG "lesson"\r\n', messages: [{ id: "internal-id", role: "user", content: "Explain retrieval", timestamp: 0 }] as LhMessage[] });
	assert.equal(out.filename, "RAG lesson.md");
	assert.match(out.markdown, /Explain retrieval/);
	assert.doesNotMatch(out.markdown, /internal-id/);
	assert.doesNotMatch(out.filename, /[\r\n/"\\]/);
});
test("export includes board explanations without unportable private API links", () => {
	const out = lessonExport({ title: "RAG", messages: [] }, [{ title: "Retrieve evidence", beats: [{ title: "Find context", caption: "Retrieve relevant passages before answering.", kind: "text", duration: 4 }] }]);
	assert.match(out.markdown, /Retrieve relevant passages/);
	assert.match(out.markdown, /not the video files/);
	assert.doesNotMatch(out.markdown, /\/api\//);
});
