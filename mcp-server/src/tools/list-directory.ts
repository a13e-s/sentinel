/**
 * list_directory MCP Tool
 *
 * Lists files and directories in the target repository.
 * Supports recursive listing and glob filtering.
 */

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { createToolResult, type ToolResult } from '../types/tool-responses.js';
import { createValidationError, createGenericError } from '../utils/error-formatter.js';
import { resolveExistingRepoPath } from '../utils/path-security.js';

export const ListDirectoryInputSchema = z.object({
  directory_path: z.string().optional().describe('Directory path relative to repo root (default: root)'),
  recursive: z.boolean().optional().describe('List files recursively (default: false)'),
  max_depth: z.number().optional().describe('Maximum recursion depth (default: 3)'),
});

export type ListDirectoryInput = z.infer<typeof ListDirectoryInputSchema>;

export const LIST_DIRECTORY_DESCRIPTION =
  'List files and directories in the target repository. Returns names, types, and sizes. Use recursive=true to scan subdirectories.';

/** Directories to skip during recursive listing. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor', 'coverage']);

interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

function listDir(dirPath: string, recursive: boolean, maxDepth: number, currentDepth: number): DirEntry[] {
  const entries: DirEntry[] = [];

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const entry of dirEntries) {
    const relativeName = entry.name;

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(relativeName)) continue;

      entries.push({ name: relativeName + '/', type: 'directory' });

      if (recursive && currentDepth < maxDepth) {
        const subEntries = listDir(
          path.join(dirPath, relativeName),
          true,
          maxDepth,
          currentDepth + 1,
        );
        for (const sub of subEntries) {
          entries.push({
            ...sub,
            name: relativeName + '/' + sub.name,
          });
        }
      }
    } else if (entry.isFile()) {
      let size: number | undefined;
      try {
        size = fs.statSync(path.join(dirPath, relativeName)).size;
      } catch {
        // skip size on error
      }
      entries.push({ name: relativeName, type: 'file', ...(size !== undefined && { size }) });
    }
  }

  return entries;
}

/**
 * Create list_directory handler scoped to targetDir.
 */
export function createListDirectoryHandler(targetDir: string) {
  return async function listDirectory(args: ListDirectoryInput): Promise<ToolResult> {
    try {
      const dirPath = resolveExistingRepoPath(targetDir, args.directory_path, 'directory');

      const recursive = args.recursive ?? false;
      const maxDepth = args.max_depth ?? 3;
      const entries = listDir(dirPath, recursive, maxDepth, 0);

      const result = {
        status: 'success' as const,
        message: `Listed ${entries.length} entries in ${args.directory_path ?? '.'}`,
        entries,
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
        message.includes('not a directory')
      ) {
        return createToolResult(createValidationError(
          message,
          false,
          { directoryPath: args.directory_path, allowedBase: targetDir },
        ));
      }
      return createToolResult(createGenericError(error, false, { directoryPath: args.directory_path }));
    }
  };
}
