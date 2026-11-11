const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseSeries, resolveSeries, writeSeries } = require("../src/series");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-fractality-test-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("parses a JSON array and a {timeSeries} object", () => {
	assert.deepStrictEqual(parseSeries("[1, 2.5, 3]"), [1, 2.5, 3]);
	assert.deepStrictEqual(parseSeries('{"timeSeries": [4, 5]}'), [4, 5]);
});

test("parses JSON rows with a column", () => {
	assert.deepStrictEqual(parseSeries('[{"rr": 800}, {"rr": 810}]', "rr"), [800, 810]);
	assert.throws(() => parseSeries('[{"rr": 800}]'), /pass `column`/);
});

test("parses one value per line and a single comma-separated line", () => {
	assert.deepStrictEqual(parseSeries("1\n2\n\n3\n"), [1, 2, 3]);
	assert.deepStrictEqual(parseSeries("1, 2, 3"), [1, 2, 3]);
});

test("parses CSV with a header by column name or index", () => {
	const csv = "time,rr\n0,800\n1,812\n2,790\n";
	assert.deepStrictEqual(parseSeries(csv, "rr"), [800, 812, 790]);
	assert.deepStrictEqual(parseSeries(csv, 1), [800, 812, 790]);
	assert.throws(() => parseSeries(csv), /pass `column`/);
	assert.throws(() => parseSeries(csv, "hr"), /not found/);
});

test("rejects non-numeric values with their position", () => {
	assert.throws(() => parseSeries("1\n2\nabc"), /position 2/);
	assert.throws(() => resolveSeries({ series: [1, NaN] }), /position 1/);
});

test("resolveSeries requires exactly one input", () => {
	assert.throws(() => resolveSeries({}), /series/);
	assert.throws(() => resolveSeries({ series: [1], filePath: "x.csv" }), /not both/);
	assert.throws(() => resolveSeries({ filePath: path.join(tmp, "missing.csv") }), /File not found/);
});

test("writeSeries round-trips through csv, json and txt", () => {
	const values = [3, 1, 4, 1, 5];
	for (const ext of ["csv", "json", "txt"]) {
		const file = writeSeries(path.join(tmp, "nested", `s.${ext}`), values, { note: "x" });
		const column = ext === "csv" ? "value" : undefined;
		assert.deepStrictEqual(resolveSeries({ filePath: file, column }).values, values, ext);
	}
});
