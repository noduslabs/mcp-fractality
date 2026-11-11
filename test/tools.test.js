const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const tools = require("../src/tools");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-fractality-test-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const unit = { signalRange: [0, 1], generateIntegers: false, maxInlinePoints: 4096 };

test("generate reaches a target alpha and returns the series inline", () => {
	const r = tools.generate({ signalLength: 512, targetAlpha: 1.25, seed: 3, ...unit });
	assert.strictEqual(r.timeSeries.length, 512);
	assert.ok(Math.abs(r.measured.alpha - 1.25) < 0.08, `alpha ${r.measured.alpha}`);
	assert.strictEqual(r.generator, "fourier");
	assert.strictEqual(r.outputFile, undefined);
});

test("generate presets map to their alpha", () => {
	for (const [signalType, alpha] of [["Random", 0.5], ["Fractal", 1], ["Gradient", 1.5]]) {
		const r = tools.generate({ signalLength: 256, signalType, seed: 2, signalRange: [1000, 2000] });
		assert.ok(Math.abs(r.measured.alpha - alpha) < 0.08, `${signalType}: alpha ${r.measured.alpha}`);
		assert.ok(r.timeSeries.every((v) => Number.isInteger(v) && v >= 1000 && v <= 2000));
	}
});

test("generate is reproducible with a seed", () => {
	const a = tools.generate({ signalLength: 128, seed: 7 });
	const b = tools.generate({ signalLength: 128, seed: 7 });
	assert.deepStrictEqual(a.timeSeries, b.timeSeries);
});

test("generate hits crossover targets", () => {
	const r = tools.generate({ signalLength: 1024, targetAlpha1: 1.2, targetAlpha2: 0.6, seed: 5, ...unit });
	assert.ok(Math.abs(r.measured.alpha1 - 1.2) < 0.1, `alpha1 ${r.measured.alpha1}`);
	assert.ok(Math.abs(r.measured.alpha2 - 0.6) < 0.1, `alpha2 ${r.measured.alpha2}`);
});

test("generate writes long series to a file instead of inline", () => {
	const r = tools.generate({ signalLength: 2048, seed: 1 });
	assert.strictEqual(r.timeSeries, undefined);
	assert.ok(fs.existsSync(r.outputFile));
	assert.match(r.note, /2048 points/);
	fs.rmSync(r.outputFile);
});

test("generate honours outputFile and includeSeries", () => {
	const file = path.join(tmp, "signal.json");
	const r = tools.generate({ signalLength: 128, seed: 1, outputFile: file, includeSeries: true });
	assert.strictEqual(r.outputFile, file);
	const saved = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.deepStrictEqual(saved.timeSeries, r.timeSeries);
	assert.strictEqual(saved.generatedWith.measured.alpha, r.measured.alpha);
});

test("generate rejects bad lengths and ranges", () => {
	assert.throws(() => tools.generate({ signalLength: 4 }), /signalLength/);
	assert.throws(() => tools.generate({ signalRange: [5, 1] }), /signalRange/);
});

test("analyzeDfa measures what generate produced", () => {
	const g = tools.generate({ signalLength: 512, targetAlpha: 0.75, seed: 4, ...unit });
	const r = tools.analyzeDfa({ series: g.timeSeries });
	assert.strictEqual(r.alpha, g.measured.alpha);
	assert.strictEqual(r.labels.dfa, "correlated");
	assert.match(r.interpretation.alpha, /correlated/);
	assert.ok(r.alpha2 !== null);
	assert.deepStrictEqual(r.warnings, []);
});

test("analyzeDfa labels white noise and warns on short series", () => {
	const g = tools.generate({ signalLength: 128, signalType: "Random", seed: 1, ...unit });
	const r = tools.analyzeDfa({ series: g.timeSeries, includeScales: true });
	assert.strictEqual(r.labels.alpha, "random");
	assert.ok(r.scales.length === r.fluctuations.length && r.scales.length > 0);
	assert.match(r.warnings[0], /alpha2/);
	assert.throws(() => tools.analyzeDfa({ series: [1, 2, 3] }), /at least 16/);
});

test("analyzeDfa reads a CSV file", () => {
	const g = tools.generate({ signalLength: 256, seed: 9, outputFile: path.join(tmp, "s.csv") });
	const r = tools.analyzeDfa({ filePath: g.outputFile, column: "value" });
	assert.strictEqual(r.alpha, g.measured.alpha);
	assert.strictEqual(r.source, g.outputFile);
});

test("analyzeMultifractal separates multifractal from monofractal signals", () => {
	const multi = tools.generate({ signalLength: 1024, fractality: "multifractal", multifractalWidth: 0.5, seed: 3, ...unit });
	const mono = tools.generate({ signalLength: 1024, targetAlpha: 1, seed: 3, ...unit });
	const a = tools.analyzeMultifractal({ series: multi.timeSeries });
	const b = tools.analyzeMultifractal({ series: mono.timeSeries });
	assert.strictEqual(a.label, "multifractal");
	assert.strictEqual(a.verdict.global.significant, true);
	assert.strictEqual(b.label, "monofractal");
	assert.ok(a.width > b.width);
	assert.strictEqual(a.q.length, a.hq.length);
	assert.deepStrictEqual(a.warnings, []);
});

test("analyzeMultifractal options and spectrum", () => {
	const g = tools.generate({ signalLength: 256, seed: 1, ...unit });
	const r = tools.analyzeMultifractal({ series: g.timeSeries, qMin: -3, qMax: 3, qStep: 1, surrogateCount: 0, includeSpectrum: true });
	assert.deepStrictEqual(r.q, [-3, -2, -1, 0, 1, 2, 3]);
	assert.strictEqual(r.spectrum.falpha.length, 7);
	assert.strictEqual(r.verdict.global.significant, null);
	assert.match(r.warnings.join(" "), /1024/);
	assert.throws(() => tools.analyzeMultifractal({ series: g.timeSeries.slice(0, 32) }), /at least 64/);
});

test("listSignalTypes describes the presets", () => {
	const r = tools.listSignalTypes();
	assert.deepStrictEqual(r.presets.map((p) => p.alpha), [0.5, 0.75, 1, 1.5]);
});

