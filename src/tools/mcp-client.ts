/**
 * MCP Client Integration
 *
 * Connects to the Sentinel MCP helper server via stdio transport
 * using @langchain/mcp-adapters, providing LangChain-compatible tools
 * for the agent loop.
 */

import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { StructuredToolInterface } from '@langchain/core/tools';
import path from 'node:path';

/** Path to the compiled MCP server entry point. */
const MCP_SERVER_ENTRY = path.resolve(
  import.meta.dirname,
  '../../mcp-server/dist/index.js',
);

/**
 * Create MCP client connected to the Sentinel helper server.
 *
 * The client spawns the MCP server as a child process communicating over stdio.
 * Returns LangChain-compatible tools that can be passed directly to the agent loop.
 *
 * @param targetDir - Absolute path to the target repository for deliverable saving
 * @returns Connected client and tools array
 */
export async function createMcpTools(
  targetDir: string,
): Promise<{ client: MultiServerMCPClient; tools: StructuredToolInterface[] }> {
  const client = new MultiServerMCPClient({
    'sentinel-helper': {
      transport: 'stdio',
      command: 'node',
      args: [MCP_SERVER_ENTRY],
      env: {
        TARGET_DIR: targetDir,
      },
    },
  });

  const tools = await client.getTools();
  return { client, tools };
}

/**
 * Gracefully close the MCP client and its child process.
 */
export async function closeMcpClient(client: MultiServerMCPClient): Promise<void> {
  await client.close();
}
