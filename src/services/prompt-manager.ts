/**
 * Prompt template loading, @include() processing, and variable interpolation.
 */

import { fs, path } from 'zx';
import { PentestError } from '../types/errors.js';
import { handlePromptError } from './error-handling.js';
import type { Authentication, DistributedConfig } from '../types/config.js';
import type { ActivityLogger } from '../types/activity-logger.js';

// MCP agent mapping — assigns each agent to a specific Playwright instance.
// Keys are promptTemplate values from the AGENTS registry.
// NOTE: Temporary local definition until session-manager is ported (Task 11).
const MCP_AGENT_MAPPING: Readonly<Record<string, string>> = Object.freeze({
  'pre-recon-code': 'playwright-agent1',
  recon: 'playwright-agent2',
  'vuln-injection': 'playwright-agent1',
  'vuln-xss': 'playwright-agent2',
  'vuln-auth': 'playwright-agent3',
  'vuln-ssrf': 'playwright-agent4',
  'vuln-authz': 'playwright-agent5',
  'exploit-injection': 'playwright-agent1',
  'exploit-xss': 'playwright-agent2',
  'exploit-auth': 'playwright-agent3',
  'exploit-ssrf': 'playwright-agent4',
  'exploit-authz': 'playwright-agent5',
  'report-executive': 'playwright-agent3',
});

// === Content Isolation ===

/**
 * Variables containing untrusted external content (website responses, tool output,
 * previous phase findings). These get wrapped in <external-content> tags during
 * substitution to defend against indirect prompt injection.
 */
const UNTRUSTED_VARIABLES: ReadonlySet<string> = new Set([
  'FINDINGS',
  'RECON_RESULTS',
  'VULN_RESULTS',
  'EXPLOIT_RESULTS',
  'TOOL_OUTPUT',
  'SCAN_RESULTS',
  'SOURCE_ANALYSIS',
]);

/** Wrap a variable's value in isolation tags if it contains untrusted external content. */
function wrapIfUntrusted(variableName: string, value: string): string {
  if (!UNTRUSTED_VARIABLES.has(variableName)) {
    return value;
  }
  const sourceName = variableName.toLowerCase().replace(/_/g, '-');
  return `<external-content source="${sourceName}">\n${value}\n</external-content>`;
}

interface PromptVariables {
  webUrl: string;
  repoPath: string;
  MCP_SERVER?: string;
}

interface IncludeReplacement {
  placeholder: string;
  content: string;
}

/** Build complete login instructions from authentication config. */
async function buildLoginInstructions(authentication: Authentication, logger: ActivityLogger): Promise<string> {
  try {
    // 1. Load the login instructions template
    const loginInstructionsPath = path.join(import.meta.dirname, '..', '..', 'prompts', 'shared', 'login-instructions.txt');

    if (!await fs.pathExists(loginInstructionsPath)) {
      throw new PentestError(
        'Login instructions template not found',
        'filesystem',
        false,
        { loginInstructionsPath }
      );
    }

    const fullTemplate = await fs.readFile(loginInstructionsPath, 'utf8');

    const getSection = (content: string, sectionName: string): string => {
      const regex = new RegExp(`<!-- BEGIN:${sectionName} -->([\\s\\S]*?)<!-- END:${sectionName} -->`, 'g');
      const match = regex.exec(content);
      return match ? match[1]!.trim() : '';
    };

    // 2. Extract sections based on login type
    const loginType = authentication.login_type?.toUpperCase();
    let loginInstructions = '';

    const commonSection = getSection(fullTemplate, 'COMMON');
    const authSection = loginType ? getSection(fullTemplate, loginType) : '';
    const verificationSection = getSection(fullTemplate, 'VERIFICATION');

    // 3. Assemble instructions from sections (fallback to full template if markers missing)
    if (!commonSection && !authSection && !verificationSection) {
      logger.warn('Section markers not found, using full login instructions template');
      loginInstructions = fullTemplate;
    } else {
      loginInstructions = [commonSection, authSection, verificationSection]
        .filter(section => section)
        .join('\n\n');
    }

    // 4. Interpolate login flow and credential placeholders
    let userInstructions = (authentication.login_flow ?? []).join('\n');

    if (authentication.credentials) {
      if (authentication.credentials.username) {
        userInstructions = userInstructions.replace(/\$username/g, authentication.credentials.username);
      }
      if (authentication.credentials.password) {
        userInstructions = userInstructions.replace(/\$password/g, authentication.credentials.password);
      }
      if (authentication.credentials.totp_secret) {
        userInstructions = userInstructions.replace(
          /\$totp/g,
          'generated TOTP code using the generate_totp MCP tool',
        );
      }
    }

    loginInstructions = loginInstructions.replace(/{{user_instructions}}/g, userInstructions);

    return loginInstructions;
  } catch (error) {
    if (error instanceof PentestError) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new PentestError(
      `Failed to build login instructions: ${errMsg}`,
      'config',
      false,
      { authentication, originalError: errMsg }
    );
  }
}

/** Process @include() directives in prompt templates. */
async function processIncludes(content: string, baseDir: string): Promise<string> {
  const includeRegex = /@include\(([^)]+)\)/g;
  const replacements: IncludeReplacement[] = await Promise.all(
    Array.from(content.matchAll(includeRegex)).map(async (match) => {
      const includePath = path.join(baseDir, match[1]!);
      const sharedContent = await fs.readFile(includePath, 'utf8');
      return {
        placeholder: match[0],
        content: sharedContent,
      };
    })
  );

  for (const replacement of replacements) {
    content = content.replace(replacement.placeholder, replacement.content);
  }
  return content;
}

/** Interpolate template variables and config-driven sections. */
async function interpolateVariables(
  template: string,
  variables: PromptVariables,
  config: DistributedConfig | null = null,
  logger: ActivityLogger
): Promise<string> {
  try {
    if (!template || typeof template !== 'string') {
      throw new PentestError(
        'Template must be a non-empty string',
        'validation',
        false,
        { templateType: typeof template, templateLength: template?.length }
      );
    }

    if (!variables || !variables.webUrl || !variables.repoPath) {
      throw new PentestError(
        'Variables must include webUrl and repoPath',
        'validation',
        false,
        { variables: Object.keys(variables || {}) }
      );
    }

    let result = template
      .replace(/{{WEB_URL}}/g, variables.webUrl)
      .replace(/{{REPO_PATH}}/g, variables.repoPath)
      .replace(/{{MCP_SERVER}}/g, variables.MCP_SERVER || 'playwright-agent1');

    if (config) {
      const hasAvoidRules = config.avoid && config.avoid.length > 0;
      const hasFocusRules = config.focus && config.focus.length > 0;

      if (!hasAvoidRules && !hasFocusRules) {
        const cleanRulesSection = '<rules>\nNo specific rules or focus areas provided for this test.\n</rules>';
        result = result.replace(/<rules>[\s\S]*?<\/rules>/g, cleanRulesSection);
      } else {
        const avoidRules = hasAvoidRules ? config.avoid!.map(r => `- ${r.description}`).join('\n') : 'None';
        const focusRules = hasFocusRules ? config.focus!.map(r => `- ${r.description}`).join('\n') : 'None';

        result = result
          .replace(/{{RULES_AVOID}}/g, avoidRules)
          .replace(/{{RULES_FOCUS}}/g, focusRules);
      }

      if (config.authentication?.login_flow) {
        const loginInstructions = await buildLoginInstructions(config.authentication, logger);
        result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, loginInstructions);
      } else {
        result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, '');
      }
    } else {
      const cleanRulesSection = '<rules>\nNo specific rules or focus areas provided for this test.\n</rules>';
      result = result.replace(/<rules>[\s\S]*?<\/rules>/g, cleanRulesSection);
      result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, '');
    }

    const remainingPlaceholders = result.match(/\{\{[^}]+\}\}/g);
    if (remainingPlaceholders) {
      logger.warn(`Found unresolved placeholders in prompt: ${remainingPlaceholders.join(', ')}`);
    }

    return result;
  } catch (error) {
    if (error instanceof PentestError) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new PentestError(
      `Variable interpolation failed: ${errMsg}`,
      'prompt',
      false,
      { originalError: errMsg }
    );
  }
}

/**
 * Substitute external content variables with isolation wrapping.
 *
 * Replaces `{{VARIABLE_NAME}}` placeholders for untrusted variables, wrapping
 * each value in `<external-content source="...">` tags. Trusted variables are
 * substituted as-is without wrapping.
 */
export function substituteWithIsolation(
  template: string,
  variables: Readonly<Record<string, string>>
): string {
  let result = template;
  for (const [name, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${name}\\}\\}`, 'g');
    result = result.replace(pattern, wrapIfUntrusted(name, value));
  }
  return result;
}

/** Load and interpolate a prompt template by name. */
export async function loadPrompt(
  promptName: string,
  variables: PromptVariables,
  config: DistributedConfig | null = null,
  pipelineTestingMode: boolean = false,
  logger: ActivityLogger
): Promise<string> {
  try {
    // 1. Resolve prompt file path
    const baseDir = pipelineTestingMode ? 'prompts/pipeline-testing' : 'prompts';
    const promptsDir = path.join(import.meta.dirname, '..', '..', baseDir);
    const promptPath = path.join(promptsDir, `${promptName}.txt`);

    if (pipelineTestingMode) {
      logger.info(`Using pipeline testing prompt: ${promptPath}`);
    }

    if (!await fs.pathExists(promptPath)) {
      throw new PentestError(
        `Prompt file not found: ${promptPath}`,
        'prompt',
        false,
        { promptName, promptPath }
      );
    }

    // 2. Assign MCP server based on agent name
    const enhancedVariables: PromptVariables = { ...variables };

    const mcpServer = MCP_AGENT_MAPPING[promptName];
    if (mcpServer) {
      enhancedVariables.MCP_SERVER = mcpServer;
      logger.info(`Assigned ${promptName} -> ${enhancedVariables.MCP_SERVER}`);
    } else {
      enhancedVariables.MCP_SERVER = 'playwright-agent1';
      logger.warn(`Unknown agent ${promptName}, using fallback -> ${enhancedVariables.MCP_SERVER}`);
    }

    // 3. Read template file
    let template = await fs.readFile(promptPath, 'utf8');

    // 4. Process @include directives
    template = await processIncludes(template, promptsDir);

    // 5. Interpolate variables and return final prompt
    return await interpolateVariables(template, enhancedVariables, config, logger);
  } catch (error) {
    if (error instanceof PentestError) {
      throw error;
    }
    const wrappedError = error instanceof Error ? error : new Error(String(error));
    const promptError = handlePromptError(promptName, wrappedError);
    throw promptError.error;
  }
}
