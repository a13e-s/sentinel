/**
 * execute_command MCP Tool
 *
 * Executes shell commands in the target repository directory.
 * Used by agents for reconnaissance (nmap, curl, etc.) and code analysis.
 *
 * NOTE: Uses execFileSync with /bin/sh -c to provide shell features (pipes, redirects)
 * through the safer execFile API. Commands run inside a sandboxed Docker container
 * with limited access — the command input comes from the AI agent, not end users.
 */

import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { createToolResult, type ToolResult } from '../types/tool-responses.js';
import { createValidationError, createGenericError } from '../utils/error-formatter.js';

export const ExecuteCommandInputSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout_seconds: z.number().optional().describe('Command timeout in seconds (default: 30, max: 120)'),
});

export type ExecuteCommandInput = z.infer<typeof ExecuteCommandInputSchema>;

export const EXECUTE_COMMAND_DESCRIPTION =
  'Execute a shell command in the target repository directory. Use for running reconnaissance tools (curl, nmap, etc.), inspecting files, or any command-line operations needed for security analysis. Commands run with a timeout to prevent hangs.';

/** Maximum allowed timeout in seconds. */
const MAX_TIMEOUT_SECONDS = 120;

/** Default timeout in seconds. */
const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * Create execute_command handler scoped to targetDir.
 */
export function createExecuteCommandHandler(targetDir: string) {
  return async function executeCommand(args: ExecuteCommandInput): Promise<ToolResult> {
    try {
      const timeoutSeconds = Math.min(
        args.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS,
        MAX_TIMEOUT_SECONDS,
      );
      const timeoutMs = timeoutSeconds * 1000;

      let stdout: string;
      let stderr: string;
      let exitCode = 0;

      try {
        // execFileSync with /bin/sh -c provides shell features (pipes, redirects)
        // through the safer execFile API. The command comes from the AI agent
        // running inside a sandboxed Docker container, not from end users.
        const output = execFileSync('/bin/sh', ['-c', args.command], {
          cwd: targetDir,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024, // 1 MB
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, HOME: process.env['HOME'] ?? '/home/sentinel' },
        });
        stdout = typeof output === 'string' ? output : '';
        stderr = '';
      } catch (error: unknown) {
        const execError = error as {
          status?: number;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
          signal?: string;
        };

        if (execError.killed || execError.signal === 'SIGTERM') {
          return createToolResult(createValidationError(
            `Command timed out after ${timeoutSeconds} seconds`,
            true,
            { command: args.command },
          ));
        }

        exitCode = execError.status ?? 1;
        stdout = execError.stdout ?? '';
        stderr = execError.stderr ?? '';
      }

      // Truncate output if too large
      const maxOutput = 50_000;
      const truncatedStdout = stdout.length > maxOutput
        ? stdout.slice(0, maxOutput) + '\n... (output truncated)'
        : stdout;
      const truncatedStderr = stderr.length > maxOutput
        ? stderr.slice(0, maxOutput) + '\n... (output truncated)'
        : stderr;

      const result = {
        status: 'success' as const,
        message: exitCode === 0 ? 'Command executed successfully' : `Command exited with code ${exitCode}`,
        exitCode,
        stdout: truncatedStdout,
        ...(truncatedStderr.length > 0 && { stderr: truncatedStderr }),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (error) {
      return createToolResult(createGenericError(error, false, { command: args.command }));
    }
  };
}
