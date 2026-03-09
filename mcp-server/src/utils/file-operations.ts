/**
 * File Operations Utilities
 *
 * Handles file system operations for deliverable saving.
 * Ported from tools/save_deliverable.js (lines 117-130).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolveRepoOutputPath } from './path-security.js';

/**
 * Save deliverable file to deliverables/ directory
 *
 * @param targetDir - Target directory for deliverables (passed explicitly to avoid race conditions)
 * @param filename - Name of the deliverable file
 * @param content - File content to save
 */
export function saveDeliverableFile(targetDir: string, filename: string, content: string): string {
  const deliverablesDir = resolveRepoOutputPath(targetDir, 'deliverables');

  // Ensure deliverables directory exists
  try {
    mkdirSync(deliverablesDir, { recursive: true });
  } catch {
    throw new Error(`Cannot create deliverables directory at ${deliverablesDir}`);
  }

  const filepath = resolveRepoOutputPath(targetDir, `deliverables/${filename}`);

  // Write file (atomic write - single operation)
  writeFileSync(filepath, content, 'utf8');

  return filepath;
}
