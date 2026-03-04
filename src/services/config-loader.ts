/**
 * Config Loader Service
 *
 * Wraps parseConfig + distributeConfig with Result type for explicit error handling.
 * Reads config files from disk and passes YAML strings to the parser.
 * Pure service with no Temporal dependencies.
 */

import { fs } from 'zx';
import { parseConfig, distributeConfig } from '../config-parser.js';
import { PentestError } from '../types/errors.js';
import { type Result, ok, err } from '../types/result.js';
import { ErrorCode } from '../types/errors.js';
import type { Config, DistributedConfig } from '../types/config.js';

/**
 * Service for loading and distributing configuration files.
 *
 * Provides a Result-based API for explicit error handling,
 * allowing callers to decide how to handle failures.
 */
export class ConfigLoaderService {
  /**
   * Load and distribute a configuration file.
   *
   * @param configPath - Path to the YAML configuration file
   * @returns Result containing DistributedConfig on success, PentestError on failure
   */
  async load(configPath: string): Promise<Result<DistributedConfig, PentestError>> {
    try {
      // 1. Verify file exists
      if (!(await fs.pathExists(configPath))) {
        return err(
          new PentestError(
            `Configuration file not found: ${configPath}`,
            'config',
            false,
            { configPath },
            ErrorCode.CONFIG_NOT_FOUND,
          )
        );
      }

      // 2. Read file content
      const configContent = await fs.readFile(configPath, 'utf8');

      // 3. Parse YAML string and validate
      const config = parseConfig(configContent);

      // 4. Distribute config for pipeline consumption
      const distributed = distributeConfig(config);
      return ok(distributed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      let errorCode = ErrorCode.CONFIG_PARSE_ERROR;
      if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
        errorCode = ErrorCode.CONFIG_NOT_FOUND;
      } else if (errorMessage.includes('validation failed')) {
        errorCode = ErrorCode.CONFIG_VALIDATION_FAILED;
      }

      return err(
        new PentestError(
          `Failed to load config ${configPath}: ${errorMessage}`,
          'config',
          false,
          { configPath, originalError: errorMessage },
          errorCode,
          error instanceof Error ? error : undefined,
        )
      );
    }
  }

  /**
   * Load config if path is provided, otherwise return null config.
   *
   * @param configPath - Optional path to the YAML configuration file
   * @returns Result containing DistributedConfig (or null) on success, PentestError on failure
   */
  async loadOptional(
    configPath: string | undefined
  ): Promise<Result<DistributedConfig | null, PentestError>> {
    if (!configPath) {
      return ok(null);
    }
    return this.load(configPath);
  }

  /**
   * Load raw Config (including models section) for model resolution.
   *
   * @param configPath - Path to the YAML configuration file
   * @returns Result containing Config on success, PentestError on failure
   */
  async loadRaw(configPath: string): Promise<Result<Config, PentestError>> {
    try {
      if (!(await fs.pathExists(configPath))) {
        return err(
          new PentestError(
            `Configuration file not found: ${configPath}`,
            'config',
            false,
            { configPath },
            ErrorCode.CONFIG_NOT_FOUND,
          )
        );
      }

      const configContent = await fs.readFile(configPath, 'utf8');
      const config = parseConfig(configContent);
      return ok(config);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      let errorCode = ErrorCode.CONFIG_PARSE_ERROR;
      if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
        errorCode = ErrorCode.CONFIG_NOT_FOUND;
      } else if (errorMessage.includes('validation failed')) {
        errorCode = ErrorCode.CONFIG_VALIDATION_FAILED;
      }

      return err(
        new PentestError(
          `Failed to load config ${configPath}: ${errorMessage}`,
          'config',
          false,
          { configPath, originalError: errorMessage },
          errorCode,
          error instanceof Error ? error : undefined,
        )
      );
    }
  }

  /**
   * Load raw config if path is provided, otherwise return null.
   */
  async loadRawOptional(
    configPath: string | undefined
  ): Promise<Result<Config | null, PentestError>> {
    if (!configPath) {
      return ok(null);
    }
    return this.loadRaw(configPath);
  }
}
