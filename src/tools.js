const DFA = require("dfa-variability");
const { generateSignal } = require("generate-fractal-signal");
const { resolveSeries, writeSeries, tempSeriesPath } = require("./series");

const MIN_POINTS = 16;
const MAX_POINTS = 65536;
const DEFAULT_MAX_INLINE = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(value, digits = 4) {
	if (typeof value !== "number" || !Number.isFinite(value)) return value === undefined ? undefined : value;
	const k = 10 ** digits;
	return Math.round(value * k) / k;
}

function roundAll(values) {
	return Array.isArray(values) ? values.map((v) => round(v)) : values;
}

function describeRange(values) {
	let min = Infinity;
	let max = -Infinity;
	let sum = 0;
	for (const v of values) {
		if (v < min) min = v;
		if (v > max) max = v;
		sum += v;
	}
	return { min: round(min), max: round(max), mean: round(sum / values.length) };
}

function dfaSettings(params) {
	const pick = ["minWindow", "shortMax", "longMin", "longMaxFraction"];
	const out = {};
	for (const key of pick) if (params[key] !== undefined) out[key] = params[key];
	if (params.scaleGrow !== undefined) out.expStep = params.scaleGrow;
	if (params.linearStep !== undefined) out.step = params.linearStep;
	return out;
}

/** One-line reading of an alpha value, following the dfa-variability thresholds. */
function interpretAlpha(alpha) {
	if (typeof alpha !== "number" || !Number.isFinite(alpha)) return null;
	if (alpha < 0.45) return "anti-correlated: large values tend to be followed by small ones";
	if (alpha <= 0.55) return "white noise: no memory, each value independent of the previous ones";
	if (alpha < 0.95) return "correlated: short-term memory, fluctuations stay around a mean";
	if (alpha <= 1.05) return "1/f (pink) noise: fractal, self-similar across scales";
	if (alpha < 1.45) return "strongly correlated: persistent trends dominate over short-term variation";
	return "Brownian motion: random walk, long trends overpower short-term variation";
}

// ---------------------------------------------------------------------------
// DFA (monofractal)
// ---------------------------------------------------------------------------

function summariseDfa(r, { includeScales = false } = {}) {
	const summary = {
		lengthOfData: r.lengthOfData,
		alpha: round(r.alpha),
		alpha1: round(r.alpha1),
		alpha2: round(r.alpha2),
		alpha1Range: r.alpha1Range,
		alpha2Range: r.alpha2Range,
		labels: {
			alpha: r.alphaLabel,
			alpha1: r.alpha1Label,
			alpha2: r.alpha2Label,
			dfa: r.dfaLabel,
			dfa1: r.dfa1Label,
			dfa2: r.dfa2Label,
		},
		interpretation: {
			alpha: interpretAlpha(r.alpha),
			alpha1: interpretAlpha(r.alpha1),
			alpha2: interpretAlpha(r.alpha2),
		},
		fractalScore: {
			alpha: r.alphaScoreNumeric,
			alpha1: r.alpha1ScoreNumeric,
			alpha2: r.alpha2ScoreNumeric,
		},
		statistics: {
			mean: round(r.meanValue),
			variance: round(r.averageVariance),
			SDNN: round(r.SDNN),
			RMSSD: round(r.RMSSD),
			lnRMSSD: round(r.lnRMSSD),
			PNN50: round(r.PNN50),
			averageDifferences: round(r.averageDifferences),
		},
	};
	if (includeScales) {
		summary.scales = r.scales;
		summary.fluctuations = roundAll(r.fluctuations);
		summary.coefficients = { slope: round(r.coefficients.slope), intercept: round(r.coefficients.intercept) };
	}
	return summary;
}

function lengthWarnings(n, { multifractal = false } = {}) {
	const warnings = [];
	if (n < 256) warnings.push(`alpha2 needs roughly 256+ points; this series has ${n}, so alpha2 may be null or unreliable.`);
	if (multifractal && n < 1024) {
		warnings.push(`Multifractal verdicts are most reliable on 1024+ points; this series has ${n}, so treat the label as indicative.`);
	}
	return warnings;
}

function analyzeDfa(params) {
	const { values, source } = resolveSeries(params);
	if (values.length < MIN_POINTS) throw new Error(`DFA needs at least ${MIN_POINTS} points; got ${values.length}.`);
	const s = { minWindow: 4, expStep: 0.25, step: 2, shortMax: 16, longMin: 16, longMaxFraction: 0.25, ...dfaSettings(params) };
	const r = new DFA(values).compute(s.minWindow, s.expStep, s.step, s.shortMax, s.longMin, s.longMaxFraction, params.level || "moderate");
	return {
		source,
		level: params.level || "moderate",
		...summariseDfa(r, params),
		warnings: lengthWarnings(values.length),
	};
}

// ---------------------------------------------------------------------------
// MFDFA (multifractal)
// ---------------------------------------------------------------------------

function summariseVerdict(v) {
	if (!v) return v;
	return {
		label: v.label,
		source: v.source,
		significant: v.significant,
		z: round(v.z),
		p: round(v.p),
		width: round(v.width),
		excess: round(v.excess),
		surrogateWidth: round(v.surrogateWidth),
		surrogateSd: round(v.surrogateSd),
		surrogateCount: v.surrogateCount,
	};
}

function summariseMultifractal(mf, { includeSpectrum = false } = {}) {
	const summary = {
		label: mf.multifractalLabel,
		width: round(mf.multifractalWidth),
		width1: round(mf.width1),
		width2: round(mf.width2),
		label1: mf.multifractalLabel1,
		label2: mf.multifractalLabel2,
		hMin: round(mf.hMin),
		hMax: round(mf.hMax),
		verdict: {
			global: summariseVerdict(mf.verdict && mf.verdict.global),
			alpha1: summariseVerdict(mf.verdict && mf.verdict.alpha1),
			alpha2: summariseVerdict(mf.verdict && mf.verdict.alpha2),
		},
		monofractal: mf.monofractal && {
			alpha: round(mf.monofractal.alpha),
			alpha1: round(mf.monofractal.alpha1),
			alpha2: round(mf.monofractal.alpha2),
		},
		hCurve: {
			slope: round(mf.hCurveSlope),
			curvature: round(mf.hCurveCurvature),
			nonlinearity: round(mf.hCurveNonlinearity),
		},
		q: mf.q,
		hq: roundAll(mf.hq),
		hq1: roundAll(mf.hq1),
		hq2: roundAll(mf.hq2),
	};
	if (includeSpectrum) {
		summary.spectrum = { alpha: roundAll(mf.alpha), falpha: roundAll(mf.falpha), tau: roundAll(mf.tau) };
	}
	return summary;
}

function multifractalOptions(params) {
	const out = dfaSettings(params);
	for (const key of ["qMin", "qMax", "qStep", "surrogateCount", "seed"]) if (params[key] !== undefined) out[key] = params[key];
	return out;
}

function analyzeMultifractal(params) {
	const { values, source } = resolveSeries(params);
	if (values.length < 64) throw new Error(`Multifractal DFA needs at least 64 points; got ${values.length}.`);
	const options = { seed: 42, ...multifractalOptions(params) };
	const mf = new DFA(values).computeMultifractal(options);
	return {
		source,
		lengthOfData: values.length,
		...summariseMultifractal(mf, params),
		reading:
			"Use `label` / `verdict.global`. A significant verdict means the temporal ordering carries multifractality " +
			"that shuffled copies of the same values do not; source \"distribution\" means the width comes from fat-tailed values, not the dynamics.",
		warnings: lengthWarnings(values.length, { multifractal: true }),
	};
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const GENERATOR_KEYS = [
	"signalLength",
	"signalRange",
	"signalType",
	"targetAlpha",
	"alphaType",
	"targetAlpha1",
	"targetAlpha2",
	"fractality",
	"multifractalWidth",
	"multifractalIntensity",
	"generator",
	"numTrials",
	"tolerance",
	"seed",
	"accentuation",
	"discreteLevels",
	"generateIntegers",
	"minWindow",
	"scaleGrow",
	"linearStep",
	"shortMax",
	"longMin",
	"longMaxFraction",
	"crossoverScale",
];

function generate(params) {
	const config = {};
	for (const key of GENERATOR_KEYS) if (params[key] !== undefined && params[key] !== null) config[key] = params[key];
	if (config.signalLength !== undefined && (config.signalLength < MIN_POINTS || config.signalLength > MAX_POINTS)) {
		throw new Error(`signalLength must be between ${MIN_POINTS} and ${MAX_POINTS}.`);
	}
	if (config.signalRange && !(config.signalRange[0] < config.signalRange[1])) {
		throw new Error("signalRange must be [min, max] with min < max.");
	}

	const r = generateSignal(config);
	const series = r.timeSeries;
	const maxInline = params.maxInlinePoints === undefined ? DEFAULT_MAX_INLINE : params.maxInlinePoints;

	const summary = {
		signalLength: r.signalLength,
		signalRange: r.signalRange,
		fractality: r.fractality,
		targets: r.targets,
		targetMultifractalWidth: r.targetMultifractalWidth,
		measured: {
			alpha: round(r.alpha),
			alpha1: round(r.alpha1),
			alpha2: round(r.alpha2),
			achievedAlpha: round(r.achievedAlpha),
			labels: { alpha: r.dfa.alphaLabel, dfa: r.dfa.dfaLabel },
			interpretation: interpretAlpha(r.alpha),
		},
		score: round(r.score),
		multifractal: r.multifractal ? summariseMultifractal(r.multifractal.full) : null,
		cascadeIntensity: r.multifractal ? round(r.multifractal.cascadeIntensity) : undefined,
		generator: r.generator,
		trials: r.trials,
		seed: r.seed,
		valueRange: describeRange(series),
		warnings: r.warnings,
	};

	let outputFile = params.outputFile;
	if (!outputFile && series.length > maxInline) outputFile = tempSeriesPath();
	if (outputFile) {
		summary.outputFile = writeSeries(outputFile, series, { generatedWith: summary });
	}
	if (!params.outputFile && series.length <= maxInline) summary.timeSeries = series;
	else if (params.includeSeries) summary.timeSeries = series;
	else summary.note = `Series of ${series.length} points written to outputFile (inline limit: ${maxInline}).`;

	return summary;
}

function listSignalTypes() {
	return {
		presets: [
			{ name: "Aleatory", alpha: 0.5, synonyms: ["Random", "Stochastic", "WhiteNoise", "Uniform"], meaning: "random, no correlation" },
			{ name: "Stationary", alpha: 0.75, synonyms: ["Stable", "Regular", "Mosaic"], meaning: "short-term memory around a stable mean" },
			{ name: "Fractal", alpha: 1, synonyms: ["PinkNoise", "Transitional", "Adaptive"], meaning: "1/f noise, self-similar across scales" },
			{ name: "Gradient", alpha: 1.5, synonyms: ["BrownNoise", "Shifting", "NonStationary", "Unstable"], meaning: "random walk, long trends dominate" },
		],
		notes: [
			"targetAlpha overrides the preset; useful range is about 0.2-1.7 (DFA saturates above ~1.7).",
			"alpha1 covers scales 4-16, alpha2 scales 16-N/4 and needs N >= 256 (1024+ recommended for crossover targets).",
			"Multifractal widths >= 0.4 come out significant on 1024 points; ~0.2 is indistinguishable from the finite-size floor.",
		],
	};
}

module.exports = { generate, analyzeDfa, analyzeMultifractal, listSignalTypes, interpretAlpha, MIN_POINTS, MAX_POINTS };
