import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { LAB_CATALOG } from "../src/core/lab-curriculum.ts";
import { labStageBlocker } from "../src/core/lab.ts";
import type { LabSession } from "../src/core/lab.ts";

test("original catalog has consistent IDs, prerequisites, questions, and resources", () => {
	const ids = new Set(LAB_CATALOG.items.map(item => item.id));
	assert.equal(ids.size, LAB_CATALOG.items.length);
	assert.deepEqual(new Set(LAB_CATALOG.tracks.map(track => track.id)), new Set(["dsa", "ai", "electronics", "systems"]));
	const visiting = new Set<string>(), finished = new Set<string>();
	function visit(id: string) {
		assert(!visiting.has(id), `Prerequisite cycle at ${id}`);
		if (finished.has(id)) return;
		visiting.add(id);
		for (const parent of LAB_CATALOG.items.find(item => item.id === id)!.prerequisites) { assert(ids.has(parent), `Missing prerequisite ${parent}`); visit(parent); }
		visiting.delete(id); finished.add(id);
	}
	const resources = new Map<string, string>();
	for (const item of LAB_CATALOG.items) {
		assert.match(item.id, /^[a-z0-9-]+$/);
		assert(LAB_CATALOG.tracks.some(track => track.id === item.trackId));
		assert(item.content.length >= 300, `${item.id} needs substantive original content`);
		assert(item.objectives.length && item.hints.length && item.questions.length);
		assert.equal(new Set(item.questions.map(question => question.id)).size, item.questions.length);
		visit(item.id);
		for (const question of item.questions) {
			assert(question.prompt && question.explanation);
			if (question.options) assert(question.answer !== undefined && Number.isInteger(question.answer) && question.answer >= 0 && question.answer < question.options.length);
			else assert(question.rubric?.length);
		}
		for (const resource of item.resources) {
			assert.equal(new URL(resource.url).protocol, "https:");
			assert(!resources.has(resource.id) || resources.get(resource.id) === resource.url, `Conflicting resource ${resource.id}`);
			resources.set(resource.id, resource.url);
		}
		if (item.coding) {
			assert.equal(item.kind, "coding");
			assert(item.coding.tests.length >= 4, `${item.id} needs edge-case tests`);
			assert.equal(new Set(item.coding.tests.map(test => test.id)).size, item.coding.tests.length);
			for (const test of item.coding.tests) assert(test.tolerance === undefined || Number.isFinite(test.tolerance) && test.tolerance >= 0);
		}
	}
	assert(!JSON.stringify(LAB_CATALOG).includes("\u2014"), "Catalog follows the user's punctuation preference");
});

test("every noncoding exercise offers an explanation field that can satisfy the stage gate", () => {
	for (const item of LAB_CATALOG.items.filter(item => !item.coding)) {
		const open = item.questions.find(question => !question.options);
		assert(open, `${item.id} needs an open explanation prompt`);
		const session = { stage: "attempt", reasoning: "This is my own explanation of the concept and the approach I will test.", answers: { [open.id]: "This answer states my assumptions and explains a concrete example." } } as unknown as LabSession;
		assert.equal(labStageBlocker(session, item, "test"), null, item.id);
	}
});

test("trusted catalog reference solutions satisfy every declared Python test", context => {
	// Only repository-authored reference code runs here. Learner code never runs on the server.
	const python = process.env.LH_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
	const exercises = LAB_CATALOG.items.filter(item => item.coding).map(item => ({ id: item.id, ...item.coding! }));
	const script = `import json, sys, math, copy
def equal(actual, expected, tolerance):
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        return isinstance(actual, (int, float)) and not isinstance(actual, bool) and math.isfinite(actual) and abs(actual-expected) <= tolerance
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(equal(a,b,tolerance) for a,b in zip(actual,expected))
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() and all(equal(actual[k],expected[k],tolerance) for k in expected)
    return actual == expected
count = 0
for exercise in json.load(sys.stdin):
    namespace = {}
    exec(exercise['solution'], namespace)
    for case in exercise['tests']:
        actual = namespace[exercise['entrypoint']](*copy.deepcopy(case['args']))
        if not equal(actual, case['expected'], case.get('tolerance', 0)):
            raise AssertionError(exercise['id'] + '/' + case['id'] + ': ' + repr(actual) + ' != ' + repr(case['expected']))
        count += 1
print(count)
`;
	const result = spawnSync(python, ["-I", "-c", script], { input: JSON.stringify(exercises), encoding: "utf8", timeout: 15000, windowsHide: true });
	if (result.error && "code" in result.error && result.error.code === "ENOENT") { context.skip("Python is unavailable in this environment."); return; }
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(Number(result.stdout.trim()), exercises.reduce((sum, exercise) => sum + exercise.tests.length, 0));
});
