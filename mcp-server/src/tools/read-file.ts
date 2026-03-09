/**
 * read_file MCP Tool
 *
 * Reads file contents from the target repository.
 * Scoped to the target directory to prevent path traversal.
 */

import { z } from 'zod';
import fs from 'node:fs';
import { createToolResult, type ToolResult } from '../types/tool-responses.js';
import { createValidationError, createGenericError } from '../utils/error-formatter.js';
import { resolveExistingRepoPath } from '../utils/path-security.js';

export const ReadFileInputSchema = z.object({
  file_path: z.string().describe('Path to the file to read, relative to the repository root'),
  max_lines: z.number().optional().describe('Maximum number of lines to return (default: all)'),
  offset: z.number().optional().describe('Line number to start reading from (0-based, default: 0)'),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

export const READ_FILE_DESCRIPTION =
  'Read a file from the target repository. Use relative paths from the repo root. Returns file contents as text. Use max_lines and offset to read large files in chunks.';

/**
 * Create read_file handler scoped to targetDir.
 */
export function createReadFileHandler(targetDir: string) {
  return async function readFile(args: ReadFileInput): Promise<ToolResult> {
    try {
      const resolvedPath = resolveExistingRepoPath(targetDir, args.file_path, 'file');

      // Read with optional line slicing
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      const offset = args.offset ?? 0;
      const maxLines = args.max_lines ?? lines.length;
      const sliced = lines.slice(offset, offset + maxLines);

      const result = {
        status: 'success' as const,
        message: `Read ${sliced.length} lines from ${args.file_path}`,
        content: sliced.join('\n'),
        totalLines: lines.length,
        ...(offset > 0 && { offset }),
        ...(maxLines < lines.length && { truncated: true }),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('outside the repository') ||
        message.includes('symbolic link') ||
        message.includes('not found') ||
        message.includes('not a file')
      ) {
        return createToolResult(createValidationError(
          message,
          false,
          { filePath: args.file_path, allowedBase: targetDir },
        ));
      }
      return createToolResult(createGenericError(error, false, { filePath: args.file_path }));
    }
  };
}
