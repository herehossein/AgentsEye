import fsp from 'node:fs/promises';
import path from 'node:path';
import { TOOL_NAME } from '../config/constants.js';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function logInfo(options: { quiet?: boolean }, message: string): void {
  if (!options.quiet) process.stderr.write(`[${TOOL_NAME}] ${message}\n`);
}

export function logWarn(options: { quiet?: boolean }, message: string): void {
  if (!options.quiet) process.stderr.write(`[${TOOL_NAME}] warning: ${message}\n`);
}

export const shortText = (value: unknown, limit: number = 160): string => String(value ?? '').slice(0, limit);

export function safeJsonStringify(obj: unknown, space: number = 0, maxDepth: number = 100): string {
  const ancestors: unknown[] = [];
  return JSON.stringify(
    obj,
    function (this: unknown, _key: string, value: unknown) {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'number' && !Number.isFinite(value)) return null;
      if (typeof value !== 'object' || value === null) return value;
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }
      if (ancestors.includes(value)) return '[Circular]';
      if (ancestors.length >= maxDepth) return '[DeeplyNested]';
      ancestors.push(value);
      return value;
    },
    space
  );
}

export function parsePngSize(buffer: Buffer | Uint8Array | null | undefined): { width: number; height: number } | null {
  if (!buffer || buffer.length < 24) return null;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const signature = buf.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

export async function writeFileSecure(filePath: string, data: string | NodeJS.ArrayBufferView): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fsp.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}
