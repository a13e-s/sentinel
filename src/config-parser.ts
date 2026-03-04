/**
 * YAML configuration parser with JSON Schema validation.
 * Parses and validates config strings against the Sentinel config schema,
 * including the models section for provider-agnostic model configuration.
 */

import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { Ajv, type ValidateFunction, type ErrorObject } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';
import { PentestError } from './types/errors.js';
import { ErrorCode } from './types/errors.js';
import type {
  Config,
  Rule,
  Authentication,
  DistributedConfig,
} from './types/config.js';
import type { ActivityLogger } from './types/activity-logger.js';

// Handle ESM/CJS interop for ajv-formats using require
const require = createRequire(import.meta.url);
const addFormats: FormatsPlugin = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

let configSchema: object;
let validateSchema: ValidateFunction;

try {
  const schemaUrl = new URL('../configs/config-schema.json', import.meta.url);
  const schemaPath = fileURLToPath(schemaUrl);
  const schemaContent = readFileSync(schemaPath, 'utf8');
  configSchema = JSON.parse(schemaContent) as object;
  validateSchema = ajv.compile(configSchema);
} catch (error) {
  const errMsg = error instanceof Error ? error.message : String(error);
  throw new PentestError(
    `Failed to load configuration schema: ${errMsg}`,
    'config',
    false,
    { schemaPath: '../configs/config-schema.json', originalError: errMsg },
  );
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /\.\.\//, // Path traversal
  /[<>]/, // HTML/XML injection
  /javascript:/i, // JavaScript URLs
  /data:/i, // Data URLs
  /file:/i, // File URLs
];

/**
 * Format a single AJV error into a human-readable message.
 */
function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || 'root';
  const params = error.params as Record<string, unknown>;

  switch (error.keyword) {
    case 'required': {
      const missingProperty = params.missingProperty as string;
      return `Missing required field: "${missingProperty}" at ${path || 'root'}`;
    }

    case 'type': {
      const expectedType = params.type as string;
      return `Invalid type at ${path}: expected ${expectedType}`;
    }

    case 'enum': {
      const allowedValues = params.allowedValues as unknown[];
      const formattedValues = allowedValues.map((v) => `"${v}"`).join(', ');
      return `Invalid value at ${path}: must be one of [${formattedValues}]`;
    }

    case 'additionalProperties': {
      const additionalProperty = params.additionalProperty as string;
      return `Unknown field at ${path}: "${additionalProperty}" is not allowed`;
    }

    case 'minLength': {
      const limit = params.limit as number;
      return `Value at ${path} is too short: must have at least ${limit} character(s)`;
    }

    case 'maxLength': {
      const limit = params.limit as number;
      return `Value at ${path} is too long: must have at most ${limit} character(s)`;
    }

    case 'minimum': {
      const limit = params.limit as number;
      return `Value at ${path} is too small: must be >= ${limit}`;
    }

    case 'maximum': {
      const limit = params.limit as number;
      return `Value at ${path} is too large: must be <= ${limit}`;
    }

    case 'minItems': {
      const limit = params.limit as number;
      return `Array at ${path} has too few items: must have at least ${limit} item(s)`;
    }

    case 'maxItems': {
      const limit = params.limit as number;
      return `Array at ${path} has too many items: must have at most ${limit} item(s)`;
    }

    case 'pattern': {
      const pattern = params.pattern as string;
      return `Value at ${path} does not match required pattern: ${pattern}`;
    }

    case 'format': {
      const format = params.format as string;
      return `Value at ${path} must be a valid ${format}`;
    }

    case 'const': {
      const allowedValue = params.allowedValue as unknown;
      return `Value at ${path} must be exactly "${allowedValue}"`;
    }

    case 'oneOf': {
      return `Value at ${path} must match exactly one schema (matched ${params.passingSchemas ?? 0})`;
    }

    case 'anyOf': {
      return `Value at ${path} must match at least one of the allowed schemas`;
    }

    case 'not': {
      return `Value at ${path} matches a schema it should not match`;
    }

    case 'if': {
      return `Value at ${path} does not satisfy conditional schema requirements`;
    }

    case 'uniqueItems': {
      const i = params.i as number;
      const j = params.j as number;
      return `Array at ${path} contains duplicate items at positions ${j} and ${i}`;
    }

    case 'propertyNames': {
      const propertyName = params.propertyName as string;
      return `Invalid property name at ${path}: "${propertyName}" does not match naming requirements`;
    }

    case 'dependencies':
    case 'dependentRequired': {
      const property = params.property as string;
      const missingProperty = params.missingProperty as string;
      return `Missing dependent field at ${path}: "${missingProperty}" is required when "${property}" is present`;
    }

    default: {
      const message = error.message || `validation failed for keyword "${error.keyword}"`;
      return `${path}: ${message}`;
    }
  }
}

/**
 * Format all AJV errors into a list of human-readable messages.
 */
function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map(formatAjvError);
}

/** Parse a YAML config string and validate it against the Sentinel config schema. */
export function parseConfig(configString: string, logger?: ActivityLogger): Config {
  // 1. Guard against empty input
  if (!configString.trim()) {
    throw new PentestError(
      'Configuration string is empty',
      'config',
      false,
      {},
      ErrorCode.CONFIG_VALIDATION_FAILED,
    );
  }

  // 2. Parse YAML with safe schema
  let config: unknown;
  try {
    config = yaml.load(configString, {
      schema: yaml.FAILSAFE_SCHEMA,
      json: false,
    });
  } catch (yamlError) {
    const errMsg = yamlError instanceof Error ? yamlError.message : String(yamlError);
    throw new PentestError(
      `YAML parsing failed: ${errMsg}`,
      'config',
      false,
      { originalError: errMsg },
      ErrorCode.CONFIG_PARSE_ERROR,
    );
  }

  // 3. Guard against null/undefined parse result
  if (config === null || config === undefined) {
    throw new PentestError(
      'Configuration string resulted in null/undefined after parsing',
      'config',
      false,
      {},
      ErrorCode.CONFIG_PARSE_ERROR,
    );
  }

  // 4. Coerce FAILSAFE_SCHEMA string values to proper types
  const coerced = coerceTypes(config);

  // 5. Validate schema, security rules, and return
  const validatedConfig = coerced as Config;
  validateConfig(validatedConfig, logger);

  return validatedConfig;
}

/**
 * Coerce FAILSAFE_SCHEMA string values to numbers/booleans where the schema expects them.
 * FAILSAFE_SCHEMA parses everything as strings, so numeric fields like temperature
 * and maxOutputTokens need conversion before AJV validation.
 */
function coerceTypes(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(coerceTypes);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'string' && isNumericField(key)) {
      const num = Number(value);
      if (!Number.isNaN(num)) {
        result[key] = num;
        continue;
      }
    }
    result[key] = coerceTypes(value);
  }
  return result;
}

const NUMERIC_FIELDS = new Set([
  'temperature',
  'maxOutputTokens',
  'max_concurrent_pipelines',
]);

function isNumericField(key: string): boolean {
  return NUMERIC_FIELDS.has(key);
}

function validateConfig(config: Config, logger?: ActivityLogger): void {
  if (!config || typeof config !== 'object') {
    throw new PentestError(
      'Configuration must be a valid object',
      'config',
      false,
      {},
      ErrorCode.CONFIG_VALIDATION_FAILED,
    );
  }

  if (Array.isArray(config)) {
    throw new PentestError(
      'Configuration must be an object, not an array',
      'config',
      false,
      {},
      ErrorCode.CONFIG_VALIDATION_FAILED,
    );
  }

  const isValid = validateSchema(config);
  if (!isValid) {
    const errors = validateSchema.errors || [];
    const errorMessages = formatAjvErrors(errors);
    throw new PentestError(
      `Configuration validation failed:\n  - ${errorMessages.join('\n  - ')}`,
      'config',
      false,
      { validationErrors: errorMessages },
      ErrorCode.CONFIG_VALIDATION_FAILED,
    );
  }

  performSecurityValidation(config);

  const warn = logger ? (msg: string) => logger.warn(msg) : (_msg: string) => {};
  if (!config.rules && !config.authentication) {
    warn(
      'Configuration file contains no rules or authentication. The pentest will run without any scoping restrictions or login capabilities.',
    );
  } else if (config.rules && !config.rules.avoid && !config.rules.focus) {
    warn(
      'Configuration file contains no rules. The pentest will run without any scoping restrictions.',
    );
  }
}

function performSecurityValidation(config: Config): void {
  if (config.authentication) {
    const auth = config.authentication;

    if (auth.login_url) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(auth.login_url)) {
          throw new PentestError(
            `authentication.login_url contains potentially dangerous pattern: ${pattern.source}`,
            'config',
            false,
            { field: 'login_url', pattern: pattern.source },
            ErrorCode.CONFIG_VALIDATION_FAILED,
          );
        }
      }
    }

    if (auth.credentials) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(auth.credentials.username)) {
          throw new PentestError(
            `authentication.credentials.username contains potentially dangerous pattern: ${pattern.source}`,
            'config',
            false,
            { field: 'credentials.username', pattern: pattern.source },
            ErrorCode.CONFIG_VALIDATION_FAILED,
          );
        }
        if (pattern.test(auth.credentials.password)) {
          throw new PentestError(
            `authentication.credentials.password contains potentially dangerous pattern: ${pattern.source}`,
            'config',
            false,
            { field: 'credentials.password', pattern: pattern.source },
            ErrorCode.CONFIG_VALIDATION_FAILED,
          );
        }
      }
    }

    if (auth.login_flow) {
      auth.login_flow.forEach((step, index) => {
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(step)) {
            throw new PentestError(
              `authentication.login_flow[${index}] contains potentially dangerous pattern: ${pattern.source}`,
              'config',
              false,
              { field: `login_flow[${index}]`, pattern: pattern.source },
              ErrorCode.CONFIG_VALIDATION_FAILED,
            );
          }
        }
      });
    }
  }

  if (config.rules) {
    validateRulesSecurity(config.rules.avoid, 'avoid');
    validateRulesSecurity(config.rules.focus, 'focus');

    checkForDuplicates(config.rules.avoid || [], 'avoid');
    checkForDuplicates(config.rules.focus || [], 'focus');
    checkForConflicts(config.rules.avoid, config.rules.focus);
  }
}

function validateRulesSecurity(rules: Rule[] | undefined, ruleType: string): void {
  if (!rules) return;

  rules.forEach((rule, index) => {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(rule.url_path)) {
        throw new PentestError(
          `rules.${ruleType}[${index}].url_path contains potentially dangerous pattern: ${pattern.source}`,
          'config',
          false,
          { field: `rules.${ruleType}[${index}].url_path`, pattern: pattern.source },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
      if (pattern.test(rule.description)) {
        throw new PentestError(
          `rules.${ruleType}[${index}].description contains potentially dangerous pattern: ${pattern.source}`,
          'config',
          false,
          { field: `rules.${ruleType}[${index}].description`, pattern: pattern.source },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
    }

    validateRuleTypeSpecific(rule, ruleType, index);
  });
}

function validateRuleTypeSpecific(rule: Rule, ruleType: string, index: number): void {
  const field = `rules.${ruleType}[${index}].url_path`;

  switch (rule.type) {
    case 'path':
      if (!rule.url_path.startsWith('/')) {
        throw new PentestError(
          `${field} for type 'path' must start with '/'`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
      break;

    case 'subdomain':
    case 'domain':
      if (rule.url_path.includes('/')) {
        throw new PentestError(
          `${field} for type '${rule.type}' cannot contain '/' characters`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
      if (rule.type === 'domain' && !rule.url_path.includes('.')) {
        throw new PentestError(
          `${field} for type 'domain' must be a valid domain name`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
      break;

    case 'method': {
      const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      if (!allowedMethods.includes(rule.url_path.toUpperCase())) {
        throw new PentestError(
          `${field} for type 'method' must be one of: ${allowedMethods.join(', ')}`,
          'config',
          false,
          { field, ruleType: rule.type, allowedMethods },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
      break;
    }

    case 'header':
      if (!rule.url_path.match(/^[a-zA-Z0-9\-_]+$/)) {
        throw new PentestError(
          `${field} for type 'header' must be a valid header name (alphanumeric, hyphens, underscores only)`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
      break;

    case 'parameter':
      if (!rule.url_path.match(/^[a-zA-Z0-9\-_]+$/)) {
        throw new PentestError(
          `${field} for type 'parameter' must be a valid parameter name (alphanumeric, hyphens, underscores only)`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED,
        );
      }
      break;
  }
}

function checkForDuplicates(rules: Rule[], ruleType: string): void {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    const key = `${rule.type}:${rule.url_path}`;
    if (seen.has(key)) {
      throw new PentestError(
        `Duplicate rule found in rules.${ruleType}[${index}]: ${rule.type} '${rule.url_path}'`,
        'config',
        false,
        { field: `rules.${ruleType}[${index}]`, ruleType: rule.type, urlPath: rule.url_path },
        ErrorCode.CONFIG_VALIDATION_FAILED,
      );
    }
    seen.add(key);
  });
}

function checkForConflicts(avoidRules: Rule[] = [], focusRules: Rule[] = []): void {
  const avoidSet = new Set(avoidRules.map((rule) => `${rule.type}:${rule.url_path}`));

  focusRules.forEach((rule, index) => {
    const key = `${rule.type}:${rule.url_path}`;
    if (avoidSet.has(key)) {
      throw new PentestError(
        `Conflicting rule found: rules.focus[${index}] '${rule.url_path}' also exists in rules.avoid`,
        'config',
        false,
        { field: `rules.focus[${index}]`, urlPath: rule.url_path },
        ErrorCode.CONFIG_VALIDATION_FAILED,
      );
    }
  });
}

function sanitizeRule(rule: Rule): Rule {
  return {
    description: rule.description.trim(),
    type: rule.type.toLowerCase().trim() as Rule['type'],
    url_path: rule.url_path.trim(),
  };
}

function sanitizeAuthentication(auth: Authentication): Authentication {
  return {
    login_type: auth.login_type.toLowerCase().trim() as Authentication['login_type'],
    login_url: auth.login_url.trim(),
    credentials: {
      username: auth.credentials.username.trim(),
      password: auth.credentials.password,
      ...(auth.credentials.totp_secret && { totp_secret: auth.credentials.totp_secret.trim() }),
    },
    login_flow: auth.login_flow.map((step) => step.trim()),
    success_condition: {
      type: auth.success_condition.type.toLowerCase().trim() as Authentication['success_condition']['type'],
      value: auth.success_condition.value.trim(),
    },
  };
}

/** Distribute a parsed config into the format consumed by pipeline activities. */
export function distributeConfig(config: Config | null): DistributedConfig {
  const avoid = config?.rules?.avoid || [];
  const focus = config?.rules?.focus || [];
  const authentication = config?.authentication || null;

  return {
    avoid: avoid.map(sanitizeRule),
    focus: focus.map(sanitizeRule),
    authentication: authentication ? sanitizeAuthentication(authentication) : null,
  };
}
