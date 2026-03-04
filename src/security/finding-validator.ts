/**
 * Cross-phase finding validator for pipeline integrity checking.
 *
 * Validates structural integrity of findings passed between pipeline phases
 * to detect anomalies like embedded prompt injection attempts, suspiciously
 * large payloads, or malformed content that could compromise downstream agents.
 */

// === Types ===

export interface ValidationWarning {
  readonly type: string;
  readonly message: string;
  readonly severity: 'high' | 'medium' | 'low';
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly findings: string;
  readonly warnings: readonly ValidationWarning[];
}

// === Phase Schema Definitions ===

interface PhaseSchema {
  /** Human-readable description of expected content */
  readonly description: string;
  /** Maximum reasonable character length for this phase's output */
  readonly maxLength: number;
  /** Patterns that should appear in valid output (at least one must match) */
  readonly expectedPatterns: readonly RegExp[];
}

const VULN_SCHEMA: PhaseSchema = {
  description: 'Vulnerability findings with severity, location, evidence',
  maxLength: 300_000,
  expectedPatterns: [/vulnerabilit|severity|finding|evidence|risk|impact|cwe|cvss/i],
};

const EXPLOIT_SCHEMA: PhaseSchema = {
  description: 'Exploit results with proof and impact',
  maxLength: 300_000,
  expectedPatterns: [/exploit|proof|impact|reproduc|payload|request|response/i],
};

const PHASE_SCHEMAS: ReadonlyMap<string, PhaseSchema> = new Map<string, PhaseSchema>([
  ['pre-recon', {
    description: 'External scan results, service info, technology stack',
    maxLength: 500_000,
    expectedPatterns: [/scan|service|port|technolog|stack|version|server/i],
  }],
  ['recon', {
    description: 'Attack surface, endpoints, entry points',
    maxLength: 500_000,
    expectedPatterns: [/endpoint|entry.?point|attack.?surface|route|param|api/i],
  }],
  ['injection-vuln', VULN_SCHEMA],
  ['xss-vuln', VULN_SCHEMA],
  ['auth-vuln', VULN_SCHEMA],
  ['ssrf-vuln', VULN_SCHEMA],
  ['authz-vuln', VULN_SCHEMA],
  ['injection-exploit', EXPLOIT_SCHEMA],
  ['xss-exploit', EXPLOIT_SCHEMA],
  ['auth-exploit', EXPLOIT_SCHEMA],
  ['ssrf-exploit', EXPLOIT_SCHEMA],
  ['authz-exploit', EXPLOIT_SCHEMA],
  ['report', {
    description: 'Final security report in markdown',
    maxLength: 1_000_000,
    expectedPatterns: [/#|summary|finding|recommendation|executive/i],
  }],
]);

// === Injection Detection Patterns ===

/**
 * Patterns that indicate embedded system prompt injection attempts.
 * These should never appear naturally in security findings.
 */
const INJECTION_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /\bsystem\s*:\s*you\s+are\b/i, label: 'system prompt override' },
  { pattern: /\bignore\s+(all\s+)?previous\s+instructions\b/i, label: 'instruction override' },
  { pattern: /\bignore\s+(all\s+)?prior\s+instructions\b/i, label: 'instruction override' },
  { pattern: /\bdo\s+not\s+follow\s+(any\s+)?previous\b/i, label: 'instruction override' },
  { pattern: /\byou\s+are\s+now\s+(a|an)\b/i, label: 'role reassignment' },
  { pattern: /\bact\s+as\s+(a|an)\b/i, label: 'role reassignment' },
  { pattern: /\bnew\s+instructions?\s*:/i, label: 'injected instructions' },
  { pattern: /\boverride\s+(system|safety|security)\b/i, label: 'safety override' },
  { pattern: /\bdisregard\s+(your|all|any)\s+(rules|instructions|guidelines)\b/i, label: 'rule bypass' },
  { pattern: /<\|?(system|im_start|im_end)\|?>/i, label: 'chat template injection' },
  { pattern: /\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>/i, label: 'chat template injection' },
  { pattern: /\bBEGIN\s+SYSTEM\s+PROMPT\b/i, label: 'system prompt boundary' },
  { pattern: /\bEND\s+SYSTEM\s+PROMPT\b/i, label: 'system prompt boundary' },
];

/**
 * Maximum length for a single contiguous line before it becomes suspicious.
 * Legitimate findings are structured with line breaks.
 */
const MAX_SINGLE_LINE_LENGTH = 50_000;

// === Validation Logic ===

function checkContentLength(
  findings: string,
  schema: PhaseSchema,
  phase: string,
): readonly ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (findings.length > schema.maxLength) {
    warnings.push({
      type: 'content_too_long',
      message: `${phase} findings exceed maximum expected length (${findings.length} > ${schema.maxLength})`,
      severity: 'medium',
    });
  }

  // Check for suspiciously long single lines (possible payload smuggling)
  const lines = findings.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.length > MAX_SINGLE_LINE_LENGTH) {
      warnings.push({
        type: 'suspicious_line_length',
        message: `Line ${i + 1} is suspiciously long (${line.length} chars) in ${phase} findings`,
        severity: 'high',
      });
      break;
    }
  }

  return warnings;
}

function checkInjectionPatterns(
  findings: string,
): readonly ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(findings)) {
      warnings.push({
        type: 'injection_detected',
        message: `Potential prompt injection detected: ${label}`,
        severity: 'high',
      });
    }
  }

  return warnings;
}

function checkStructuralExpectations(
  findings: string,
  schema: PhaseSchema,
  phase: string,
): readonly ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  const hasExpectedContent = schema.expectedPatterns.some((pattern) =>
    pattern.test(findings)
  );

  if (!hasExpectedContent) {
    warnings.push({
      type: 'unexpected_structure',
      message: `${phase} findings do not match expected content patterns (${schema.description})`,
      severity: 'medium',
    });
  }

  return warnings;
}

/**
 * Validates findings from a pipeline phase for structural integrity.
 *
 * Checks for:
 * - Content length within reasonable bounds
 * - Embedded prompt injection patterns
 * - Expected structural patterns for the phase type
 * - Suspiciously long single lines
 *
 * Returns a validation result with the (possibly original) content and any warnings.
 * Findings with high-severity injection warnings are marked as invalid.
 */
export function validateFindings(
  phase: string,
  rawFindings: string,
): ValidationResult {
  const warnings: ValidationWarning[] = [];

  // 1. Handle empty findings
  if (rawFindings.trim().length === 0) {
    warnings.push({
      type: 'empty_findings',
      message: `${phase} produced empty findings`,
      severity: 'medium',
    });
    return { valid: true, findings: rawFindings, warnings };
  }

  // 2. Look up phase schema (unknown phases get basic validation only)
  const schema = PHASE_SCHEMAS.get(phase);
  if (schema === undefined) {
    warnings.push({
      type: 'unknown_phase',
      message: `No schema defined for phase '${phase}'; applying basic validation only`,
      severity: 'low',
    });
  }

  // 3. Check for injection patterns (always runs)
  warnings.push(...checkInjectionPatterns(rawFindings));

  // 4. Schema-specific checks
  if (schema !== undefined) {
    warnings.push(...checkContentLength(rawFindings, schema, phase));
    warnings.push(...checkStructuralExpectations(rawFindings, schema, phase));
  }

  // 5. Log warnings
  for (const warning of warnings) {
    const prefix = warning.severity === 'high' ? 'WARNING' : 'NOTICE';
    console.warn(`[FindingValidator] ${prefix}: ${warning.message}`);
  }

  // 6. Determine validity - high-severity injection warnings invalidate
  const hasHighSeverityInjection = warnings.some(
    (w) => w.type === 'injection_detected' && w.severity === 'high'
  );

  return {
    valid: !hasHighSeverityInjection,
    findings: rawFindings,
    warnings,
  };
}
