import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { unlink } from "node:fs/promises";
import { registerTools } from "./tools.js";
import { startIpcListener } from "./ipc-listener.js";
import * as H from "./handlers.js";
import { sockPath } from "../shared/paths.js";
import { log } from "../shared/log.js";

async function main(): Promise<void> {
  await H.init();

  const server = new McpServer({ name: "cadence", version: "0.1.0" });
  registerTools(server);

  // Open the hook IPC channel and drain anything spooled before we were up.
  const ipc = await startIpcListener().catch((e) => {
    log("warn", "ipc listener failed to start", String(e));
    return null;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "cadence MCP server connected");

  const shutdown = async () => {
    try {
      ipc?.close();
    } catch {
      /* ignore */
    }
    await unlink(sockPath()).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  // stderr only — stdout is the MCP stdio channel
  console.error("cadence fatal:", e);
  process.exit(1);
});
