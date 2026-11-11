#!/usr/bin/env node
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer } = require("../src/server");

createServer()
	.connect(new StdioServerTransport())
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
