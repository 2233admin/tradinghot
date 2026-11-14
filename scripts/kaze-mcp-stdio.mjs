#!/usr/bin/env node
// Kaze's MCP server speaks to the launcher over stdio, but the launcher and Kaze live on the
// host's desktop, which the worker container cannot reach. The host's relay hands the launcher
// over a unix socket instead; this shim is what the worker starts in place of the launcher:
// it opens that socket and pipes the MCP messages through it, so the collector speaks to
// Kaze's MCP server unchanged.
import net from "node:net";

const socketPath = process.env.KAZE_MCP_SOCKET;
if (!socketPath) {
  process.stderr.write("kaze-mcp-stdio: KAZE_MCP_SOCKET is not set\n");
  process.exit(1);
}

const socket = net.connect(socketPath);
socket.on("connect", () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.on("error", (error) => {
  process.stderr.write(`kaze-mcp-stdio: cannot reach Kaze's relay at ${socketPath}: ${error.message}\n`);
  process.exit(1);
});
socket.on("close", () => process.exit(0));
process.stdin.on("end", () => socket.end());
