import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_NAME } from '../config/constants.js';
import { UsageError } from '../errors/errors.js';

export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface ResolveSafePathOptions {
  allowOutsideCwd?: boolean;
}

export function resolveSafePath(
  value: unknown,
  options: ResolveSafePathOptions = {},
  label: string = 'Path',
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UsageError(`${label} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new UsageError(`${label} contains invalid characters (null byte)`);
  }
  const cwd = process.cwd();
  const absolute = path.resolve(cwd, String(value));
  const baseName = path.basename(absolute).replace(/\.[^.]*$/, '');
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(baseName)) {
    throw new UsageError(`Invalid reserved device filename: ${baseName}`);
  }
  const tempRuns = path.join(os.tmpdir(), `.${TOOL_NAME}`, 'runs');
  if (!options?.allowOutsideCwd) {
    if (!isWithin(cwd, absolute) && !isWithin(tempRuns, absolute)) {
      throw new UsageError(
        `${label} must resolve inside the current working directory (${cwd}). ` +
          'Pass --allow-outside-cwd to override.',
      );
    }
    let current = fs.existsSync(absolute) ? absolute : path.dirname(absolute);
    while (current && current !== path.dirname(current)) {
      if (fs.existsSync(current)) {
        try {
          const realParent = fs.realpathSync(current);
          const realCwd = fs.existsSync(cwd) ? fs.realpathSync(cwd) : cwd;
          const realTemp = fs.existsSync(tempRuns) ? fs.realpathSync(tempRuns) : tempRuns;
          if (!isWithin(realCwd, realParent) && !isWithin(realTemp, realParent)) {
            throw new UsageError(
              `${label} resolves outside working directory via symbolic link: ${absolute}`,
            );
          }
        } catch (e) {
          if (e instanceof UsageError) throw e;
        }
        break;
      }
      current = path.dirname(current);
    }
  }
  return absolute;
}

export function assertFileDoesNotExist(filePath: string): void {
  if (fs.existsSync(filePath)) {
    throw new UsageError(`Refusing to overwrite existing file: ${filePath}`);
  }
}

export function validateRunId(id: unknown): string {
  if (id == null || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(String(id))) {
    throw new UsageError('Run IDs may only contain letters, digits, underscores and hyphens');
  }
  return String(id);
}
