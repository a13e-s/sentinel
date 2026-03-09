import fs from 'node:fs';
import path from 'node:path';

function isContained(basePath: string, targetPath: string): boolean {
  return targetPath === basePath || targetPath.startsWith(basePath + path.sep);
}

function resolveLexicalPath(baseDir: string, userPath?: string): {
  basePath: string;
  candidatePath: string;
} {
  const basePath = path.resolve(baseDir);
  const candidatePath = userPath ? path.resolve(baseDir, userPath) : basePath;

  if (!isContained(basePath, candidatePath)) {
    throw new Error(`Path "${userPath ?? '.'}" resolves outside the repository`);
  }

  return { basePath, candidatePath };
}

/**
 * Resolve an existing repo-scoped path, rejecting symlinks by default.
 */
export function resolveExistingRepoPath(
  baseDir: string,
  userPath: string | undefined,
  expectedType: 'file' | 'directory',
): string {
  const { candidatePath } = resolveLexicalPath(baseDir, userPath);
  const realBase = fs.realpathSync(baseDir);

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidatePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${expectedType === 'directory' ? 'Directory' : 'File'} not found: ${userPath ?? '.'}`);
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Path "${userPath ?? '.'}" is a symbolic link, which is not allowed`);
  }

  const realCandidate = fs.realpathSync(candidatePath);
  if (!isContained(realBase, realCandidate)) {
    throw new Error(`Path "${userPath ?? '.'}" resolves outside the repository`);
  }

  if (expectedType === 'directory' && !stat.isDirectory()) {
    throw new Error(`"${userPath ?? '.'}" is not a directory`);
  }

  if (expectedType === 'file' && !stat.isFile()) {
    throw new Error(`"${userPath ?? '.'}" is not a file`);
  }

  return realCandidate;
}

/**
 * Resolve a repo-scoped output path, validating the parent directory even if
 * the leaf path does not exist yet. Existing leaf symlinks are rejected.
 */
export function resolveRepoOutputPath(
  baseDir: string,
  relativePath: string,
): string {
  const { basePath, candidatePath } = resolveLexicalPath(baseDir, relativePath);
  const realBase = fs.realpathSync(baseDir);
  const parentPath = path.dirname(candidatePath);

  if (!isContained(basePath, parentPath)) {
    throw new Error(`Path "${relativePath}" resolves outside the repository`);
  }

  const parentStat = fs.lstatSync(parentPath);
  if (parentStat.isSymbolicLink()) {
    throw new Error(`Parent path for "${relativePath}" is a symbolic link, which is not allowed`);
  }

  const realParent = fs.realpathSync(parentPath);
  if (!isContained(realBase, realParent)) {
    throw new Error(`Path "${relativePath}" resolves outside the repository`);
  }

  if (fs.existsSync(candidatePath)) {
    const leafStat = fs.lstatSync(candidatePath);
    if (leafStat.isSymbolicLink()) {
      throw new Error(`Path "${relativePath}" is a symbolic link, which is not allowed`);
    }
  }

  return path.join(realParent, path.basename(candidatePath));
}
