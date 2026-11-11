# mcp-fractality

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude, Cursor, etc.) **generate fractal signals** with a chosen DFA exponent and **measure the fractal structure** of any time series with DFA and multifractal DFA.

It wraps two libraries:

- [generate-fractal-signal](https://github.com/noduslabs/generate-fractal-signal): mono- and multifractal signal generation with a target α, α₁, α₂ or crossover
- [dfa-variability](https://github.com/deemeetree/dfa): Detrended Fluctuation Analysis and MFDFA with surrogate-based verdicts

## Install

Claude Code:

```sh
claude mcp add fractality -- npx -y mcp-fractality
```

Claude Desktop, Cursor and other clients (`claude_desktop_config.json`, `.cursor/mcp.json`, ...):

```json
{
	"mcpServers": {
		"fractality": {
			"command": "npx",
			"args": ["-y", "mcp-fractality"]
		}
	}
}
```

Requires Node.js 18+. The server runs locally over stdio.

## Tools

| Tool | What it does |
| --- | --- |
| `generate_fractal_signal` | Generates a series with a target α (global, α₁ or α₂), an α₁/α₂ crossover, or a multifractal width. Returns the measured exponents, labels, warnings and the series. |
| `analyze_dfa` | Measures α, α₁, α₂ of a series, labels it (white noise, correlated, 1/f, strongly correlated, Brownian) and adds SDNN / RMSSD / PNN50. |
| `analyze_multifractal` | MFDFA: h(q) curves, multifractal width and a monofractal / weak / multifractal verdict tested against shuffled surrogates. |
| `list_signal_types` | The named presets (Aleatory 0.5, Stationary 0.75, Fractal 1, Gradient 1.5) and the generator's practical limits. |

The full option list of `generate_fractal_signal` follows the [generate-fractal-signal options](https://github.com/noduslabs/generate-fractal-signal#full-option-list) (minus streaming).

### Example prompts

- "Generate 512 points of pink noise between 600 and 1200 and save it to `signal.csv`."
- "Make a 1024-point signal with α₁ = 1.2 and α₂ = 0.6."
- "Generate a multifractal series with width 0.5 and check that MFDFA agrees."
- "What kind of signal is `rr-intervals.csv`? Use the `rr` column."

### Passing series in and out

- **In:** the analysis tools take `series` (an array of numbers) or `filePath`: a JSON array, a JSON object with `timeSeries` / `series` / `data` / `values`, CSV or TSV (with `column` set to a name or 0-based index when there are several columns), or one number per line.
- **Out:** series up to `maxInlinePoints` (default 1000) are returned inline. Longer ones are written to `outputFile`, or to a temp file when none is given, and the path is returned, so long signals don't flood the model's context. `.csv` files get `index,value` rows, `.json` files get `{ timeSeries, generatedWith }`, and any other extension gets one value per line.

### Reliability notes

- Useful α range is about 0.2–1.7; DFA saturates above that on short series.
- α₂ needs about 256+ points; crossover and multifractal targets work best at 1024+.
- Multifractal widths of 0.4 and above come out significant on 1024 points. Around 0.2 a width can't be told apart from finite-size noise.

The tools add these as `warnings` in their results when they apply.

## Development

```sh
npm install
npm test        # node --test: parsing, tools, MCP protocol (in-memory and stdio)
npm start       # run the stdio server
```

Try it with the MCP Inspector: `npx @modelcontextprotocol/inspector node bin/mcp-fractality.js`.

## License

AGPL-3.0-or-later, same as generate-fractal-signal. Contact: [support.noduslabs.com](https://support.noduslabs.com)
