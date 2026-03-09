import net from 'node:net';
import { URL } from 'node:url';

export interface ParsedCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface CommandSecurityOptions {
  readonly targetWebUrl?: string;
}

export class CommandValidationError extends Error {}

const ALLOWED_EXECUTABLES = new Set([
  'curl',
  'nmap',
  'subfinder',
  'whatweb',
  'httpx',
  'pwd',
  'ls',
  'find',
  'cat',
  'head',
  'tail',
  'wc',
  'stat',
  'git',
  'jq',
]);

const DISALLOWED_OPERATOR_TOKENS = new Set(['|', '||', '&&', ';', '&', '>', '>>', '<', '<<']);
const FIND_BLOCKED_FLAGS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);
const CURL_BLOCKED_FLAGS = new Set([
  '-K',
  '--config',
  '-o',
  '-O',
  '--output',
  '-T',
  '--upload-file',
  '--unix-socket',
  '-x',
  '--proxy',
]);
const CURL_DATA_FLAGS = new Set([
  '-d',
  '--data',
  '--data-ascii',
  '--data-binary',
  '--data-raw',
  '--data-urlencode',
  '-F',
  '--form',
  '-b',
  '--cookie',
]);
const SUBFINDER_BLOCKED_FLAGS = new Set([
  '-o',
  '-oJ',
  '-oD',
  '-config',
  '-pc',
  '-dL',
  '-l',
  '-rL',
]);
const HTTPX_BLOCKED_FLAGS = new Set([
  '-o',
  '-oa',
  '-sr',
  '-srd',
  '-rr',
  '-l',
  '-input-file',
  '--store-response',
  '--store-response-dir',
]);
const WHATWEB_BLOCKED_PREFIXES = ['--log-'];
const NMAP_ALLOWED_FLAGS = new Set([
  '-Pn',
  '-sT',
  '-sV',
  '-F',
  '-n',
  '-v',
  '-vv',
  '-vvv',
  '--version-light',
  '--reason',
  '--open',
]);
const NMAP_FLAGS_WITH_VALUES = new Set([
  '-p',
  '--top-ports',
  '-T',
  '--max-retries',
  '--host-timeout',
]);
const NMAP_BLOCKED_PREFIXES = [
  '--script',
  '-o',
  '--excludefile',
  '--exclude',
  '--stylesheet',
  '--datadir',
  '--servicedb',
  '--versiondb',
  '-iL',
];
const NMAP_BLOCKED_FLAGS = new Set([
  '-A',
  '-O',
  '-sU',
  '--traceroute',
]);
const GIT_ALLOWED_SUBCOMMANDS = new Set(['status', 'diff', 'rev-parse', 'log']);
const GIT_BLOCKED_GLOBAL_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree']);
const GIT_DIFF_BLOCKED_FLAGS = new Set(['-p', '--patch', '--raw', '--name-only', '--name-status']);

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote !== null) {
    throw new CommandValidationError('Command contains an unterminated quoted string');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function getCurlInlineValue(flag: string, token: string): string | null {
  if (flag.length === 2 && token.startsWith(flag) && token !== flag) {
    return token.slice(flag.length);
  }

  if (token.startsWith(`${flag}=`)) {
    return token.slice(flag.length + 1);
  }

  return null;
}

function deriveTargetHost(targetWebUrl?: string): string | null {
  if (!targetWebUrl) {
    return null;
  }

  try {
    return new URL(targetWebUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isPrivateOrLocalIp(input: string): boolean {
  const version = net.isIP(input);
  if (version === 4) {
    const [a = 0, b = 0] = input.split('.').map((segment) => Number(segment));
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (version === 6) {
    const value = input.toLowerCase();
    return (
      value === '::1' ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb') ||
      value.startsWith('fc') ||
      value.startsWith('fd')
    );
  }

  return false;
}

function isClearlyInternalHostname(input: string): boolean {
  const value = input.toLowerCase();
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value === 'metadata.google.internal' ||
    value === 'host.docker.internal'
  );
}

function validateCurlArgs(args: readonly string[]): void {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;

    if (CURL_BLOCKED_FLAGS.has(arg)) {
      throw new CommandValidationError(`curl flag "${arg}" is not allowed`);
    }

    for (const blocked of CURL_BLOCKED_FLAGS) {
      if (arg.startsWith(`${blocked}=`)) {
        throw new CommandValidationError(`curl flag "${blocked}" is not allowed`);
      }
    }

    for (const dataFlag of CURL_DATA_FLAGS) {
      const inlineValue = getCurlInlineValue(dataFlag, arg);
      if (inlineValue !== null && inlineValue.trim().startsWith('@')) {
        throw new CommandValidationError(`curl flag "${dataFlag}" cannot read local files`);
      }

      if (arg === dataFlag) {
        const next = args[index + 1];
        if (next?.trim().startsWith('@')) {
          throw new CommandValidationError(`curl flag "${dataFlag}" cannot read local files`);
        }
      }
    }

    if (
      (arg === '-F' || arg === '--form') &&
      args[index + 1] != null &&
      /(?:^|=)@/.test(args[index + 1]!)
    ) {
      throw new CommandValidationError(`curl flag "${arg}" cannot read local files`);
    }

    if (arg.startsWith('-F') && /(?:^|=)@/.test(arg.slice(2))) {
      throw new CommandValidationError('curl form arguments cannot read local files');
    }

    if (arg.startsWith('--form=') && /(?:^|=)@/.test(arg.slice('--form='.length))) {
      throw new CommandValidationError('curl form arguments cannot read local files');
    }
  }
}

function validateFindArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (FIND_BLOCKED_FLAGS.has(arg)) {
      throw new CommandValidationError(`find flag "${arg}" is not allowed`);
    }
  }
}

function rejectBlockedFlags(
  commandName: string,
  args: readonly string[],
  blockedFlags: ReadonlySet<string>,
  blockedPrefixes: readonly string[] = [],
): void {
  for (const arg of args) {
    if (blockedFlags.has(arg)) {
      throw new CommandValidationError(`${commandName} flag "${arg}" is not allowed`);
    }

    for (const prefix of blockedPrefixes) {
      if (arg === prefix || arg.startsWith(prefix)) {
        throw new CommandValidationError(`${commandName} flag "${arg}" is not allowed`);
      }
    }
  }
}

function validateGitArgs(args: readonly string[]): void {
  if (args.length === 0) {
    throw new CommandValidationError('git requires an approved subcommand');
  }

  const subcommand = args[0]!;
  if (GIT_BLOCKED_GLOBAL_OPTIONS.has(subcommand)) {
    throw new CommandValidationError(`git global option "${subcommand}" is not allowed`);
  }

  if (!GIT_ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new CommandValidationError(`git subcommand "${subcommand}" is not allowed`);
  }

  const rest = args.slice(1);

  if (subcommand === 'diff') {
    if (!rest.some((arg) => arg === '--stat' || arg.startsWith('--stat='))) {
      throw new CommandValidationError('git diff is only allowed with --stat');
    }
    if (rest.some((arg) => GIT_DIFF_BLOCKED_FLAGS.has(arg))) {
      throw new CommandValidationError('git diff patch output is not allowed');
    }
  }

  if (subcommand === 'log' && !rest.includes('--oneline')) {
    throw new CommandValidationError('git log is only allowed with --oneline');
  }
}

function validateNmapArgs(args: readonly string[], targetWebUrl?: string): void {
  const allowedTarget = deriveTargetHost(targetWebUrl);
  if (!allowedTarget) {
    throw new CommandValidationError('nmap requires a configured target URL to scope scans');
  }

  let target: string | null = null;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;

    if (NMAP_ALLOWED_FLAGS.has(arg)) {
      continue;
    }

    if (NMAP_BLOCKED_FLAGS.has(arg)) {
      throw new CommandValidationError(`nmap flag "${arg}" is not allowed`);
    }

    if (NMAP_BLOCKED_PREFIXES.some((prefix) => arg === prefix || arg.startsWith(`${prefix}=`))) {
      throw new CommandValidationError(`nmap flag "${arg}" is not allowed`);
    }

    if (NMAP_FLAGS_WITH_VALUES.has(arg)) {
      if (args[index + 1] == null) {
        throw new CommandValidationError(`nmap flag "${arg}" requires a value`);
      }
      index++;
      continue;
    }

    if (
      /^-p.+/.test(arg) ||
      /^-T[0-5]$/.test(arg) ||
      /^--top-ports=/.test(arg) ||
      /^--max-retries=/.test(arg) ||
      /^--host-timeout=/.test(arg)
    ) {
      continue;
    }

    if (arg.startsWith('-')) {
      throw new CommandValidationError(`nmap flag "${arg}" is not allowed`);
    }

    if (target !== null) {
      throw new CommandValidationError('nmap may only scan one declared target at a time');
    }

    target = arg.toLowerCase();
  }

  if (target === null) {
    throw new CommandValidationError('nmap requires a single declared target host');
  }

  if (isClearlyInternalHostname(target) || isPrivateOrLocalIp(target)) {
    throw new CommandValidationError(`nmap target "${target}" is outside the allowed external target scope`);
  }

  if (target !== allowedTarget) {
    throw new CommandValidationError(`nmap target "${target}" is not allowed; only "${allowedTarget}" may be scanned`);
  }
}

export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    throw new CommandValidationError('Command must not be empty');
  }

  if (/[`\r\n]/.test(trimmed) || trimmed.includes('$(')) {
    throw new CommandValidationError('Shell metacharacters and multiline commands are not supported');
  }

  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0) {
    throw new CommandValidationError('Command must not be empty');
  }

  if (tokens.some((token) => DISALLOWED_OPERATOR_TOKENS.has(token))) {
    throw new CommandValidationError('Shell operators are not supported; pass a single command invocation only');
  }

  const [executable, ...args] = tokens;
  return { executable: executable!, args };
}

export function validateCommand(
  parsed: ParsedCommand,
  options?: CommandSecurityOptions,
): void {
  if (!ALLOWED_EXECUTABLES.has(parsed.executable)) {
    throw new CommandValidationError(`Command "${parsed.executable}" is not allowed`);
  }

  switch (parsed.executable) {
    case 'curl':
      validateCurlArgs(parsed.args);
      break;
    case 'find':
      validateFindArgs(parsed.args);
      break;
    case 'git':
      validateGitArgs(parsed.args);
      break;
    case 'httpx':
      rejectBlockedFlags('httpx', parsed.args, HTTPX_BLOCKED_FLAGS);
      break;
    case 'nmap':
      validateNmapArgs(parsed.args, options?.targetWebUrl);
      break;
    case 'subfinder':
      rejectBlockedFlags('subfinder', parsed.args, SUBFINDER_BLOCKED_FLAGS);
      break;
    case 'whatweb':
      rejectBlockedFlags('whatweb', parsed.args, new Set<string>(), WHATWEB_BLOCKED_PREFIXES);
      break;
    default:
      break;
  }
}

export function buildChildProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: process.env['HOME'] ?? '/home/sentinel',
    LANG: process.env['LANG'] ?? 'C.UTF-8',
  };

  for (const key of ['LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'TZ']) {
    if (process.env[key] != null) {
      env[key] = process.env[key];
    }
  }

  return env;
}
