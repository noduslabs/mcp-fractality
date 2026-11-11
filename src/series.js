const fs = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// Reading a series from a file or a string
// ---------------------------------------------------------------------------

const SERIES_KEYS = ["timeSeries", "series", "data", "values"];

function toNumber(token) {
	if (typeof token === "number") return token;
	if (typeof token !== "string" || token.trim() === "") return NaN;
	return Number(token.trim());
}

function fromJson(parsed, column) {
	let values = parsed;
	if (!Array.isArray(values) && values && typeof values === "object") {
		const key = SERIES_KEYS.find((k) => Array.isArray(values[k]));
		if (!key) throw new Error(`JSON object has no series array (looked for ${SERIES_KEYS.join(", ")}).`);
		values = values[key];
	}
	if (!Array.isArray(values)) throw new Error("JSON must be an array of numbers or an object with a series array.");
	if (values.length && typeof values[0] === "object" && values[0] !== null) {
		if (column === undefined || column === null) {
			throw new Error("JSON rows are objects: pass `column` with the field name to read.");
		}
		values = values.map((row) => (Array.isArray(row) ? row[Number(column)] : row[column]));
	}
	return values.map(toNumber);
}

function fromDelimited(text, column) {
	const rows = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"))
		.map((line) => line.split(/[,;\t ]+/).filter((t) => t !== ""));
	if (!rows.length) return [];

	let header = null;
	if (rows[0].some((t) => Number.isNaN(toNumber(t)))) header = rows.shift();

	// a single line of numbers is the series itself
	if (!header && rows.length === 1) return rows[0].map(toNumber);

	const width = Math.max(...rows.map((r) => r.length));
	let index = 0;
	if (column !== undefined && column !== null) {
		if (typeof column === "number" || /^\d+$/.test(String(column))) index = Number(column);
		else {
			index = header ? header.indexOf(String(column)) : -1;
			if (index === -1) throw new Error(`Column "${column}" not found${header ? ` (columns: ${header.join(", ")})` : ""}.`);
		}
	} else if (width > 1) {
		throw new Error(
			`Found ${width} columns${header ? ` (${header.join(", ")})` : ""}: pass \`column\` (name or 0-based index) to choose one.`
		);
	}
	return rows.map((r) => toNumber(r[index]));
}

/** Parse a series from text: JSON, CSV/TSV with optional header, or whitespace-separated numbers. */
function parseSeries(text, column) {
	const trimmed = text.trim();
	let values;
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) values = fromJson(JSON.parse(trimmed), column);
	else values = fromDelimited(trimmed, column);

	const bad = values.findIndex((v) => !Number.isFinite(v));
	if (bad !== -1) throw new Error(`Value at position ${bad} is not a finite number.`);
	return values;
}

function readSeriesFile(filePath, column) {
	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
	return parseSeries(fs.readFileSync(resolved, "utf8"), column);
}

/** Resolve the `series` / `filePath` pair that the analysis tools accept. */
function resolveSeries({ series, filePath, column }) {
	if (series && filePath) throw new Error("Pass either `series` or `filePath`, not both.");
	if (series) {
		const bad = series.findIndex((v) => !Number.isFinite(v));
		if (bad !== -1) throw new Error(`Value at position ${bad} is not a finite number.`);
		return { values: series, source: "inline" };
	}
	if (filePath) return { values: readSeriesFile(filePath, column), source: path.resolve(filePath) };
	throw new Error("Pass the time series as `series` (array of numbers) or `filePath` (CSV, TXT or JSON).");
}

// ---------------------------------------------------------------------------
// Writing a series
// ---------------------------------------------------------------------------

/** Write a series to .csv (index,value), .json ({ timeSeries, ...meta }) or anything else (one value per line). */
function writeSeries(filePath, values, meta = {}) {
	const resolved = path.resolve(filePath);
	fs.mkdirSync(path.dirname(resolved), { recursive: true });
	const ext = path.extname(resolved).toLowerCase();
	let body;
	if (ext === ".json") body = JSON.stringify({ timeSeries: values, ...meta }, null, 2);
	else if (ext === ".csv") body = "index,value\n" + values.map((v, i) => `${i},${v}`).join("\n") + "\n";
	else body = values.join("\n") + "\n";
	fs.writeFileSync(resolved, body);
	return resolved;
}

function tempSeriesPath() {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return path.join(os.tmpdir(), "mcp-fractality", `signal-${stamp}.csv`);
}

module.exports = { parseSeries, readSeriesFile, resolveSeries, writeSeries, tempSeriesPath };
