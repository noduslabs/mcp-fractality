const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const tools = require("./tools");
const { version } = require("../package.json");

// ---------------------------------------------------------------------------
// Shared schema pieces
// ---------------------------------------------------------------------------

const dfaScaleShape = {
	minWindow: z.number().int().min(2).optional().describe("Smallest DFA window (default 4)."),
	scaleGrow: z.number().positive().optional().describe("Log step between global-alpha scales (default 0.25)."),
	linearStep: z.number().int().positive().optional().describe("Linear step between alpha1/alpha2 scales (default 2)."),
	shortMax: z.number().int().positive().optional().describe("Largest window of the alpha1 fit (default 16)."),
	longMin: z.number().int().positive().optional().describe("Smallest window of the alpha2 fit (default 16)."),
	longMaxFraction: z.number().positive().max(1).optional().describe("Largest alpha2 window as a fraction of N (default 0.25)."),
};

const seriesInputShape = {
	series: z.array(z.number()).optional().describe("The time series as an array of numbers."),
	filePath: z
		.string()
		.optional()
		.describe("Path to a file with the series instead: JSON array / {timeSeries: [...]}, CSV/TSV, or one number per line."),
	column: z
		.union([z.string(), z.number().int().min(0)])
		.optional()
		.describe("Column name or 0-based index when the file has several columns."),
};

function asResult(payload) {
	const text = JSON.stringify(payload, null, 2);
	// round-trip so structuredContent carries exactly what the text shows (no undefined keys)
	return { content: [{ type: "text", text }], structuredContent: JSON.parse(text) };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function createServer() {
	const server = new McpServer({ name: "mcp-fractality", version });

	server.registerTool(
		"generate_fractal_signal",
		{
			title: "Generate fractal signal",
			description:
				"Generate a time series with a chosen fractal structure, verified with DFA. " +
				"Pick a preset (`signalType`: Aleatory α≈0.5, Stationary α≈0.75, Fractal α≈1, Gradient α≈1.5) or an explicit `targetAlpha` (useful range 0.2–1.7). " +
				"`alphaType` chooses which exponent the target applies to: global, alpha1 (short scales 4–16) or alpha2 (long scales, needs signalLength ≥ 256). " +
				"Set both `targetAlpha1` and `targetAlpha2` for a crossover signal (1024+ points recommended). " +
				"Set `fractality: \"multifractal\"` with `multifractalWidth` (≥ 0.4 is reliably detectable on 1024 points) for a multifractal signal. " +
				"Returns the measured alpha / alpha1 / alpha2 and the series; long series are written to a file instead of being returned inline.",
			inputSchema: {
				signalLength: z.number().int().min(tools.MIN_POINTS).max(tools.MAX_POINTS).optional().describe("Number of points (default 128). Powers of two suit DFA best."),
				signalRange: z.tuple([z.number(), z.number()]).optional().describe("[min, max] of the output values (default [0, 30000])."),
				signalType: z.string().optional().describe("Preset name: Aleatory, Stationary, Fractal (default), Gradient, or a synonym (Random, PinkNoise, BrownNoise...)."),
				targetAlpha: z.number().min(0).max(2.5).optional().describe("DFA exponent to aim for; overrides the preset."),
				alphaType: z.enum(["global", "alpha1", "alpha2"]).optional().describe("Which measured exponent targetAlpha applies to (default global)."),
				targetAlpha1: z.number().min(0).max(2.5).optional().describe("Short-term exponent; set together with targetAlpha2 for a crossover."),
				targetAlpha2: z.number().min(0).max(2.5).optional().describe("Long-term exponent; set together with targetAlpha1 for a crossover."),
				crossoverScale: z.number().int().positive().optional().describe("Scale where the alpha1 and alpha2 regimes meet (default 16)."),
				fractality: z.enum(["monofractal", "multifractal"]).optional().describe("Default monofractal."),
				multifractalWidth: z.number().min(0).max(2).optional().describe("Target h(qMin) − h(qMax) for multifractal signals (default 0.4)."),
				multifractalIntensity: z.number().min(0).max(1).optional().describe("Fix the cascade intensity instead of searching for it."),
				generator: z
					.enum(["auto", "fourier", "legacy", "voss", "voss4", "white", "brownian", "perlin", "ordered"])
					.optional()
					.describe("Generator (default auto = spectral synthesis). Legacy generators ignore alpha targets."),
				numTrials: z.number().int().min(1).max(500).optional().describe("Candidates to try (default 100 mono / 40 multi)."),
				tolerance: z.number().min(0).optional().describe("Stop once the score is below this (default 0.02)."),
				seed: z.number().int().optional().describe("Integer seed for reproducible output."),
				accentuation: z.number().positive().optional().describe("Contrast exponent; > 1 pushes values toward the range extremes."),
				discreteLevels: z.array(z.number()).optional().describe("Allowed output values; each point snaps to the nearest."),
				generateIntegers: z.boolean().optional().describe("Round values to integers (default true)."),
				...dfaScaleShape,
				outputFile: z.string().optional().describe("Write the series to this path (.csv, .json or .txt)."),
				includeSeries: z.boolean().optional().describe("Also return the series inline when it is written to a file."),
				maxInlinePoints: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Longest series returned inline (default 1000); longer ones go to outputFile or a temp file."),
			},
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		},
		async (params) => asResult(tools.generate(params))
	);

	server.registerTool(
		"analyze_dfa",
		{
			title: "Measure fractal scaling (DFA)",
			description:
				"Run Detrended Fluctuation Analysis on a time series and say what kind of signal it is. " +
				"Returns global alpha, alpha1 (short-term, scales 4–16) and alpha2 (long-term, scales 16–N/4, needs ~256+ points), " +
				"their labels (white noise ≈0.5, correlated, 1/f noise ≈1, strongly correlated, Brownian ≈1.5), " +
				"plain-language interpretation and basic variability statistics (SDNN, RMSSD, PNN50 — meaningful for RR intervals in ms).",
			inputSchema: {
				...seriesInputShape,
				level: z.enum(["relaxed", "moderate", "strict"]).optional().describe("Label threshold sensitivity (default moderate)."),
				includeScales: z.boolean().optional().describe("Also return the scales and fluctuation function F(s)."),
				...dfaScaleShape,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async (params) => asResult(tools.analyzeDfa(params))
	);

	server.registerTool(
		"analyze_multifractal",
		{
			title: "Measure multifractality (MFDFA)",
			description:
				"Run multifractal DFA on a time series: generalised Hurst exponents h(q), the multifractal width and a verdict " +
				"(monofractal / weak / multifractal) tested against shuffled surrogates, including whether the width comes from " +
				"temporal correlations or from a fat-tailed value distribution. Needs 64+ points; 1024+ recommended.",
			inputSchema: {
				...seriesInputShape,
				qMin: z.number().optional().describe("Smallest q (default -5)."),
				qMax: z.number().optional().describe("Largest q (default 5)."),
				qStep: z.number().positive().optional().describe("Step between q values (default 0.5)."),
				surrogateCount: z.number().int().min(0).max(200).optional().describe("Shuffled surrogates behind the verdict (default 20; 0 disables)."),
				seed: z.number().int().optional().describe("Seed for the surrogate shuffles (default 42)."),
				includeSpectrum: z.boolean().optional().describe("Also return the singularity spectrum f(α) and τ(q)."),
				...dfaScaleShape,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async (params) => asResult(tools.analyzeMultifractal(params))
	);

	server.registerTool(
		"list_signal_types",
		{
			title: "List signal presets",
			description: "List the named signal presets, their target alpha values and practical limits of the generator.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => asResult(tools.listSignalTypes())
	);

	return server;
}

module.exports = { createServer };
