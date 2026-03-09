/**
 * search_files MCP Tool
 *
 * Searches for patterns in files within the target repository.
 * Similar to grep — finds matching lines across multiple files.
 */

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { createToolResult, type ToolResult } from '../types/tool-responses.js';
import { createValidationError, createGenericError } from '../utils/error-formatter.js';
import { resolveExistingRepoPath } from '../utils/path-security.js';

export const SearchFilesInputSchema = z.object({
  pattern: z.string().describe('Text or regex pattern to search for'),
  directory_path: z.string().optional().describe('Directory to search in, relative to repo root (default: root)'),
  file_extensions: z.array(z.string()).optional().describe('File extensions to include (e.g., [".ts", ".js", ".py"])'),
  max_results: z.number().optional().describe('Maximum number of matching lines to return (default: 50)'),
  case_sensitive: z.boolean().optional().describe('Case-sensitive search (default: false)'),
});

export type SearchFilesInput = z.infer<typeof SearchFilesInputSchema>;

export const SEARCH_FILES_DESCRIPTION =
  'Search for a text pattern across files in the repository. Returns matching lines with file paths and line numbers. Supports regex patterns and file extension filtering.';

/** Directories to skip. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor', 'coverage']);

/** Binary file extensions to skip. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
  '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.gz', '.tar', '.pdf',
  '.lock', '.map',
]);

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

function collectFiles(
  dirPath: string,
  basePath: string,
  extensions: Set<string> | null,
  depth: number,
): string[] {
  if (depth > 8) return [];

  const files: string[] = [];
  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of dirEntries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...collectFiles(path.join(dirPath, entry.name), basePath, extensions, depth + 1));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (extensions && !extensions.has(ext)) continue;
      files.push(path.join(dirPath, entry.name));
    }
  }

  return files;
}

/**
 * Create search_files handler scoped to targetDir.
 */
export function createSearchFilesHandler(targetDir: string) {
  return async function searchFiles(args: SearchFilesInput): Promise<ToolResult> {
    try {
      const repoRoot = fs.realpathSync(targetDir);
      const searchDir = resolveExistingRepoPath(targetDir, args.directory_path, 'directory');

      const maxResults = args.max_results ?? 50;
      const caseSensitive = args.case_sensitive ?? false;
      const extensions = args.file_extensions
        ? new Set(args.file_extensions.map(e => e.startsWith('.') ? e.toLowerCase() : '.' + e.toLowerCase()))
        : null;

      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern, caseSensitive ? '' : 'i');
      } catch {
        return createToolResult(createValidationError(
          `Invalid regex pattern: ${args.pattern}`,
          true,
        ));
      }

      const files = collectFiles(searchDir, targetDir, extensions, 0);
      const matches: SearchMatch[] = [];

      for (const filePath of files) {
        if (matches.length >= maxResults) break;

        let content: string;
        try {
          content = fs.readFileSync(filePath, 'utf-8');
        } catch {
          continue;
        }

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break;
          if (regex.test(lines[i]!)) {
            matches.push({
              file: path.relative(repoRoot, filePath),
              line: i + 1,
              content: lines[i]!.trim().slice(0, 200),
            });
          }
        }
      }

      const result = {
        status: 'success' as const,
        message: `Found ${matches.length} matches for "${args.pattern}"`,
        matches,
        ...(matches.length >= maxResults && { truncated: true }),
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
      return createToolResult(createGenericError(error, false, { pattern: args.pattern }));
    }
  };
}
