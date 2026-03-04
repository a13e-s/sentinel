/**
 * Sentinel Helper MCP Server
 *
 * MCP server providing file system, command execution, and deliverable tools
 * for Sentinel penetration testing agents.
 *
 * Communicates via stdio transport, connected by LangChain MCP adapters.
 *
 * Usage: TARGET_DIR=/path/to/repo node dist/index.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  SaveDeliverableInputSchema,
  SAVE_DELIVERABLE_DESCRIPTION,
  createSaveDeliverableHandler,
} from './tools/save-deliverable.js';
import {
  GenerateTotpInputSchema,
  GENERATE_TOTP_DESCRIPTION,
  generateTotp,
} from './tools/generate-totp.js';
import {
  ReadFileInputSchema,
  READ_FILE_DESCRIPTION,
  createReadFileHandler,
} from './tools/read-file.js';
import {
  ListDirectoryInputSchema,
  LIST_DIRECTORY_DESCRIPTION,
  createListDirectoryHandler,
} from './tools/list-directory.js';
import {
  SearchFilesInputSchema,
  SEARCH_FILES_DESCRIPTION,
  createSearchFilesHandler,
} from './tools/search-files.js';
import {
  ExecuteCommandInputSchema,
  EXECUTE_COMMAND_DESCRIPTION,
  createExecuteCommandHandler,
} from './tools/execute-command.js';

/**
 * Create Sentinel Helper MCP Server with target directory context.
 *
 * Each workflow should create its own MCP server instance with its targetDir.
 * Handler factories capture targetDir in closures, preventing race
 * conditions when multiple workflows run in parallel.
 */
export function createSentinelHelperServer(targetDir: string): McpServer {
  const server = new McpServer({
    name: 'sentinel-helper',
    version: '1.0.0',
  });

  // 1. Register read_file tool
  const readFileHandler = createReadFileHandler(targetDir);
  server.registerTool(
    'read_file',
    {
      description: READ_FILE_DESCRIPTION,
      inputSchema: ReadFileInputSchema,
    },
    async (args): Promise<CallToolResult> => {
      const result = await readFileHandler(args);
      return result as CallToolResult;
    },
  );

  // 2. Register list_directory tool
  const listDirectoryHandler = createListDirectoryHandler(targetDir);
  server.registerTool(
    'list_directory',
    {
      description: LIST_DIRECTORY_DESCRIPTION,
      inputSchema: ListDirectoryInputSchema,
    },
    async (args): Promise<CallToolResult> => {
      const result = await listDirectoryHandler(args);
      return result as CallToolResult;
    },
  );

  // 3. Register search_files tool
  const searchFilesHandler = createSearchFilesHandler(targetDir);
  server.registerTool(
    'search_files',
    {
      description: SEARCH_FILES_DESCRIPTION,
      inputSchema: SearchFilesInputSchema,
    },
    async (args): Promise<CallToolResult> => {
      const result = await searchFilesHandler(args);
      return result as CallToolResult;
    },
  );

  // 4. Register execute_command tool
  const executeCommandHandler = createExecuteCommandHandler(targetDir);
  server.registerTool(
    'execute_command',
    {
      description: EXECUTE_COMMAND_DESCRIPTION,
      inputSchema: ExecuteCommandInputSchema,
    },
    async (args): Promise<CallToolResult> => {
      const result = await executeCommandHandler(args);
      return result as CallToolResult;
    },
  );

  // 5. Register save_deliverable tool
  const saveDeliverableHandler = createSaveDeliverableHandler(targetDir);
  server.registerTool(
    'save_deliverable',
    {
      description: SAVE_DELIVERABLE_DESCRIPTION,
      inputSchema: SaveDeliverableInputSchema,
    },
    async (args): Promise<CallToolResult> => {
      const result = await saveDeliverableHandler(args);
      return result as CallToolResult;
    },
  );

  // 6. Register generate_totp tool
  server.registerTool(
    'generate_totp',
    {
      description: GENERATE_TOTP_DESCRIPTION,
      inputSchema: GenerateTotpInputSchema,
    },
    async (args): Promise<CallToolResult> => {
      const result = await generateTotp(args);
      return result as CallToolResult;
    },
  );

  return server;
}

// === Stdio Entry Point ===

async function main(): Promise<void> {
  const targetDir = process.env['TARGET_DIR'];
  if (!targetDir) {
    console.error('ERROR: TARGET_DIR environment variable is required');
    process.exit(1);
  }

  const server = createSentinelHelperServer(targetDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Sentinel MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Re-export for programmatic usage
export { createSaveDeliverableHandler } from './tools/save-deliverable.js';
export { generateTotp } from './tools/generate-totp.js';
export * from './types/index.js';
