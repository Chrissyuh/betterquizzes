#!/usr/bin/env node
const checks = [
  ["@modelcontextprotocol/sdk/server/mcp.js", "McpServer"],
  ["@modelcontextprotocol/sdk/server/stdio.js", "StdioServerTransport"],
  ["@modelcontextprotocol/sdk/server/streamableHttp.js", "StreamableHTTPServerTransport"],
  ["@modelcontextprotocol/sdk/types.js", null],
  ["@modelcontextprotocol/ext-apps", null],
  ["zod", "z"]
];

const results = [];
for (const [specifier, namedExport] of checks) {
  const mod = await import(specifier);
  if (namedExport && !(namedExport in mod)) throw new Error(`${specifier} missing export ${namedExport}`);
  results.push({ specifier, ok: true, checkedExport: namedExport || "module" });
}
console.log(JSON.stringify({ ok: true, sdkDependencyChecks: results }, null, 2));
