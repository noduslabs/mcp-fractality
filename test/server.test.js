const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createServer } = require("../src/server");

async function connectInMemory() {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = createServer();
	const client = new Client({ name: "test", version: "0.0.0" });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return { client, close: () => Promise.all([client.close(), server.close()]) };
}

const parse = (result) => JSON.parse(result.content[0].text);

test("lists the four tools with input schemas", async () => {
	const { client, close } = await connectInMemory();
	const { tools } = await client.listTools();
	assert.deepStrictEqual(tools.map((t) => t.name).sort(), ["analyze_dfa", "analyze_multifractal", "generate_fractal_signal", "list_signal_types"]);
	const generate = tools.find((t) => t.name === "generate_fractal_signal");
	assert.strictEqual(generate.inputSchema.properties.alphaType.enum.length, 3);
	assert.strictEqual(tools.find((t) => t.name === "analyze_dfa").annotations.readOnlyHint, true);
	await close();
});

test("generate then analyze over MCP", async () => {
	const { client, close } = await connectInMemory();
	const generated = await client.callTool({
		name: "generate_fractal_signal",
		arguments: { signalLength: 256, targetAlpha: 1, seed: 11 },
	});
	assert.ok(!generated.isError);
	const g = parse(generated);
	assert.deepStrictEqual(generated.structuredContent, g);
	assert.strictEqual(g.timeSeries.length, 256);

	const analysed = parse(await client.callTool({ name: "analyze_dfa", arguments: { series: g.timeSeries } }));
	assert.strictEqual(analysed.alpha, g.measured.alpha);
	await close();
});

test("invalid arguments and tool errors come back as isError results", async () => {
	const { client, close } = await connectInMemory();
	const badSchema = await client.callTool({ name: "generate_fractal_signal", arguments: { alphaType: "alpha3" } });
	assert.strictEqual(badSchema.isError, true);
	const noInput = await client.callTool({ name: "analyze_dfa", arguments: {} });
	assert.strictEqual(noInput.isError, true);
	assert.match(noInput.content[0].text, /series/);
	await close();
});

test("stdio binary starts and answers", async () => {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [path.join(__dirname, "..", "bin", "mcp-fractality.js")],
	});
	const client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(transport);
	assert.strictEqual(client.getServerVersion().name, "mcp-fractality");
	const r = parse(await client.callTool({ name: "list_signal_types", arguments: {} }));
	assert.strictEqual(r.presets.length, 4);
	await client.close();
});
