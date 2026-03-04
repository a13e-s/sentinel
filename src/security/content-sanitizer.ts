/**
 * Content Sanitizer for Indirect Prompt Injection Defense
 *
 * Strips and escapes malicious instructions from external content before it enters
 * agent prompts. Normalizes Unicode homoglyphs and detects common prompt injection
 * patterns at configurable severity levels.
 */

// === Types ===

/** Severity classification for a detected injection pattern */
export type PatternSeverity = 'high' | 'medium' | 'low';

/** Configurable strictness for sanitization */
export type SanitizationLevel = 'strict' | 'moderate' | 'permissive';

/** A single stripped pattern with occurrence count and severity */
export interface StrippedPattern {
  readonly pattern: string;
  readonly count: number;
  readonly severity: PatternSeverity;
}

/** Result of sanitizing content */
export interface SanitizationResult {
  readonly sanitized: string;
  readonly strippedPatterns: readonly StrippedPattern[];
  readonly wasModified: boolean;
}

/** Internal definition for a pattern rule */
interface PatternRule {
  readonly regex: RegExp;
  readonly label: string;
  readonly severity: PatternSeverity;
  readonly minLevel: SanitizationLevel;
}

// === Unicode Homoglyph Normalization ===

/**
 * Map of Unicode homoglyph ranges to their ASCII equivalents.
 * Covers fullwidth Latin characters and other common lookalike substitutions
 * used to evade pattern matching.
 */
const HOMOGLYPH_MAP: ReadonlyMap<string, string> = new Map([
  // Fullwidth Latin uppercase A-Z (U+FF21..U+FF3A)
  ...Array.from({ length: 26 }, (_, i) => [
    String.fromCodePoint(0xFF21 + i),
    String.fromCharCode(65 + i),
  ] as const),
  // Fullwidth Latin lowercase a-z (U+FF41..U+FF5A)
  ...Array.from({ length: 26 }, (_, i) => [
    String.fromCodePoint(0xFF41 + i),
    String.fromCharCode(97 + i),
  ] as const),
  // Fullwidth digits 0-9 (U+FF10..U+FF19)
  ...Array.from({ length: 10 }, (_, i) => [
    String.fromCodePoint(0xFF10 + i),
    String.fromCharCode(48 + i),
  ] as const),
  // Fullwidth space (U+3000)
  ['\u3000', ' '],
  // Common lookalike characters
  ['\u0430', 'a'], // Cyrillic а
  ['\u0435', 'e'], // Cyrillic е
  ['\u043E', 'o'], // Cyrillic о
  ['\u0440', 'p'], // Cyrillic р
  ['\u0441', 'c'], // Cyrillic с
  ['\u0443', 'y'], // Cyrillic у
  ['\u0445', 'x'], // Cyrillic х
  ['\u0456', 'i'], // Cyrillic і
  ['\u04BB', 'h'], // Cyrillic һ
  ['\u0391', 'A'], // Greek Α
  ['\u0392', 'B'], // Greek Β
  ['\u0395', 'E'], // Greek Ε
  ['\u0397', 'H'], // Greek Η
  ['\u0399', 'I'], // Greek Ι
  ['\u039A', 'K'], // Greek Κ
  ['\u039C', 'M'], // Greek Μ
  ['\u039D', 'N'], // Greek Ν
  ['\u039F', 'O'], // Greek Ο
  ['\u03A1', 'P'], // Greek Ρ
  ['\u03A4', 'T'], // Greek Τ
  ['\u03A5', 'Y'], // Greek Υ
  ['\u03A7', 'X'], // Greek Χ
  ['\u03B1', 'a'], // Greek α (lowercase)
  ['\u03BF', 'o'], // Greek ο (lowercase)
  // Zero-width and invisible characters (map to empty string for removal)
  ['\u200B', ''], // Zero-width space
  ['\u200C', ''], // Zero-width non-joiner
  ['\u200D', ''], // Zero-width joiner
  ['\uFEFF', ''], // Zero-width no-break space / BOM
]);

/** Build regex that matches any homoglyph character */
const HOMOGLYPH_REGEX = new RegExp(
  `[${[...HOMOGLYPH_MAP.keys()].join('')}]`,
  'g',
);

/**
 * Normalize Unicode homoglyphs to their ASCII equivalents.
 * This prevents evasion of pattern matching via lookalike character substitution.
 */
function normalizeHomoglyphs(input: string): string {
  return input.replace(HOMOGLYPH_REGEX, (char) => HOMOGLYPH_MAP.get(char) ?? char);
}

// === Pattern Definitions ===

/** Severity level ordering for filtering by sanitization level */
const LEVEL_THRESHOLD: Record<SanitizationLevel, readonly SanitizationLevel[]> = {
  strict: ['strict', 'moderate', 'permissive'],
  moderate: ['moderate', 'permissive'],
  permissive: ['permissive'],
};

/**
 * Injection patterns ordered by severity. Each pattern defines:
 * - regex: the pattern to match (case-insensitive)
 * - label: human-readable description for reporting
 * - severity: how dangerous this pattern is
 * - minLevel: the least strict level at which this pattern is active
 */
const PATTERN_RULES: readonly PatternRule[] = [
  // === High severity: direct instruction override attempts ===
  {
    regex: /ignore\s+(all\s+)?previous\s+instructions/gi,
    label: 'ignore previous instructions',
    severity: 'high',
    minLevel: 'permissive',
  },
  {
    regex: /disregard\s+(all\s+)?(previous\s+|prior\s+|above\s+)?(instructions|rules|guidelines|constraints)/gi,
    label: 'disregard instructions',
    severity: 'high',
    minLevel: 'permissive',
  },
  {
    regex: /forget\s+everything\s+(you\s+)?(know|were\s+told|learned|above)/gi,
    label: 'forget everything',
    severity: 'high',
    minLevel: 'permissive',
  },
  {
    regex: /you\s+are\s+now\s+(?:a|an|the)\s+\w+/gi,
    label: 'role redefinition (you are now)',
    severity: 'high',
    minLevel: 'permissive',
  },
  {
    regex: /new\s+instructions?\s*:/gi,
    label: 'new instructions directive',
    severity: 'high',
    minLevel: 'permissive',
  },
  {
    regex: /override\s+(system\s+)?(prompt|instructions|rules)/gi,
    label: 'override instructions',
    severity: 'high',
    minLevel: 'permissive',
  },

  // === Medium severity: system prompt mimicry and role manipulation ===
  {
    regex: /system\s*prompt\s*:/gi,
    label: 'system prompt label',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /\[SYSTEM\]/gi,
    label: 'system tag',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /\[INST\]/gi,
    label: 'instruction tag',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /<\/?system(?:\s[^>]*)?\s*>/gi,
    label: 'XML system tag',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /<\/?instructions?\s*>/gi,
    label: 'XML instruction tag',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /<\/?prompt\s*>/gi,
    label: 'XML prompt tag',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /###\s*(?:system|instruction|prompt)\s*(?:###)?/gi,
    label: 'markdown system header',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /(?:^|\n)>\s*(?:system|instruction)\s*:/gim,
    label: 'markdown blockquote system directive',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /your\s+(?:real|true|actual|new)\s+(?:purpose|goal|objective|role|task)\s+is/gi,
    label: 'role/purpose redefinition',
    severity: 'medium',
    minLevel: 'moderate',
  },
  {
    regex: /act\s+as\s+(?:if\s+)?(?:you\s+are|a|an)\s+/gi,
    label: 'act as directive',
    severity: 'medium',
    minLevel: 'moderate',
  },

  // === Low severity: suspicious but context-dependent patterns ===
  {
    regex: /do\s+not\s+follow\s+(?:the\s+)?(?:previous|prior|above|original)\s+/gi,
    label: 'do not follow previous',
    severity: 'low',
    minLevel: 'strict',
  },
  {
    regex: /stop\s+being\s+(?:a|an)\s+\w+/gi,
    label: 'stop being directive',
    severity: 'low',
    minLevel: 'strict',
  },
  {
    regex: /from\s+now\s+on\s*,?\s*(?:you|your)/gi,
    label: 'from now on directive',
    severity: 'low',
    minLevel: 'strict',
  },
  {
    regex: /begin\s+(?:new\s+)?(?:session|conversation|context)/gi,
    label: 'session reset attempt',
    severity: 'low',
    minLevel: 'strict',
  },
];

// === Core Sanitization ===

/**
 * Get the active pattern rules for the given sanitization level.
 * Stricter levels include all patterns from less-strict levels plus their own.
 */
function getActiveRules(level: SanitizationLevel): readonly PatternRule[] {
  const allowedLevels = LEVEL_THRESHOLD[level];
  return PATTERN_RULES.filter((rule) => allowedLevels.includes(rule.minLevel));
}

/**
 * Sanitize content by stripping prompt injection patterns.
 *
 * Normalizes Unicode homoglyphs before pattern matching to prevent evasion
 * via lookalike character substitution. Returns structured results showing
 * what was stripped and at what severity.
 *
 * @param content - The raw external content to sanitize
 * @param level - Strictness level: 'strict' catches the most, 'permissive' only high-severity
 * @returns Structured result with sanitized content and metadata about stripped patterns
 */
export function sanitizeContent(
  content: string,
  level: SanitizationLevel = 'moderate',
): SanitizationResult {
  if (content.length === 0) {
    return { sanitized: '', strippedPatterns: [], wasModified: false };
  }

  // 1. Normalize homoglyphs so patterns can't be evaded with lookalike chars
  let working = normalizeHomoglyphs(content);
  const homoglyphsNormalized = working !== content;

  // 2. Apply active pattern rules and collect matches
  const matchCounts = new Map<string, { count: number; severity: PatternSeverity }>();
  const activeRules = getActiveRules(level);

  for (const rule of activeRules) {
    // Reset regex lastIndex for global regexes
    rule.regex.lastIndex = 0;
    const matches = working.match(rule.regex);
    if (matches && matches.length > 0) {
      const existing = matchCounts.get(rule.label);
      if (existing) {
        matchCounts.set(rule.label, { count: existing.count + matches.length, severity: rule.severity });
      } else {
        matchCounts.set(rule.label, { count: matches.length, severity: rule.severity });
      }
      working = working.replace(rule.regex, '');
    }
  }

  // 3. Clean up leftover whitespace from removed patterns
  working = working.replace(/\n{3,}/g, '\n\n').trim();

  // 4. Build structured result
  const strippedPatterns: StrippedPattern[] = [...matchCounts.entries()].map(
    ([pattern, { count, severity }]) => ({ pattern, count, severity }),
  );

  const wasModified = homoglyphsNormalized || strippedPatterns.length > 0;

  return {
    sanitized: working,
    strippedPatterns,
    wasModified,
  };
}
