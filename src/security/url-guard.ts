import net from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { DEFAULTS, METADATA_HOSTS, DANGEROUS_BROWSER_FLAGS } from '../config/constants.js';
import { UsageError, InspectorError } from '../errors/errors.js';

export function normalizeHost(hostname: unknown): string {
  let host = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  // WHATWG URL canonicalizes legacy numeric IPv4 forms (hex, octal, integer).
  try {
    host = new URL(`http://${host.includes(':') ? `[${host}]` : host}/`).hostname
      .replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  } catch {
    // Invalid addresses are rejected by URL parsing or DNS resolution later.
  }
  return host;
}

export function ipv6Words(host: string): number[] | null {
  if (net.isIP(host) !== 6) return null;
  let expanded = host;
  if (expanded.includes('.')) {
    const split = expanded.lastIndexOf(':');
    const octets = expanded.slice(split + 1).split('.').map(Number);
    expanded = `${expanded.slice(0, split)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = expanded.split('::');
  const left = halves[0] ? halves[0].split(':').map((part) => Number.parseInt(part, 16)) : [];
  const right = halves[1] ? halves[1].split(':').map((part) => Number.parseInt(part, 16)) : [];
  return halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left;
}

export function mappedIpv4(host: string): string | null {
  const words = ipv6Words(host);
  if (!words || words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff) return null;
  return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
}

export function isLoopbackHost(hostname: unknown): boolean {
  const host = normalizeHost(hostname);
  const ipv4 = mappedIpv4(host) || host;
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    ipv4 === '0.0.0.0' ||
    (net.isIP(ipv4) === 4 && ipv4.startsWith('127.'))
  );
}

export function isMetadataHost(hostname: unknown): boolean {
  const host = normalizeHost(hostname);
  const ipv4 = mappedIpv4(host) || host;
  if (METADATA_HOSTS.has(host) || METADATA_HOSTS.has(ipv4)) return true;
  if (host.endsWith('.metadata.google.internal') || host.endsWith('.metadata.azure.com') || host.endsWith('.metadata.goog')) return true;
  // Link-local IPv4 is reserved for metadata/security-sensitive local services.
  if (net.isIP(ipv4) === 4 && ipv4.startsWith('169.254.')) return true;
  const words = ipv6Words(host);
  return Boolean(
    words &&
      words[0] === 0xfd00 &&
      words[1] === 0xec2 &&
      words.slice(2, 7).every((word) => word === 0) &&
      words[7] === 0x254
  );
}

export function isPrivateHost(hostname: unknown): boolean {
  const host = normalizeHost(hostname);
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.localhost')
  ) {
    return true;
  }
  const rawIpv4 = mappedIpv4(host) || host;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(rawIpv4);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if ([a, b, Number(ipv4[3]), Number(ipv4[4])].some((part) => part > 255)) return false;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const words = ipv6Words(host);
  if (words) {
    if (words.every((w, i) => (i === 7 ? w === 0 || w === 1 : w === 0))) return true;
    if ((words[0] & 0xfe00) === 0xfc00) return true;
    if ((words[0] & 0xffc0) === 0xfe80) return true;
  }
  return false;
}

export function validateTargetUrl(raw: unknown): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new UsageError(`Invalid URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UsageError(`Only http(s) URLs are allowed, received ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UsageError('URLs containing credentials are not allowed');
  }
  if (isMetadataHost(url.hostname)) {
    throw new UsageError('Cloud metadata endpoints are blocked');
  }
  if (url.port && Number(url.port) > 65_535) {
    throw new UsageError('Invalid URL port');
  }
  return url;
}

export interface DnsLookupEntry {
  address: string;
  family?: number;
}

export interface ValidateResolvedHostnameOptions {
  lookup?: (hostname: string, options?: any) => Promise<DnsLookupEntry[]>;
  timeoutMs?: number;
  loopbackOnly?: boolean;
  allowPrivate?: boolean;
}

export async function validateResolvedHostname(
  hostname: unknown,
  {
    lookup = dnsLookup as any,
    timeoutMs = DEFAULTS.timeoutMs,
    loopbackOnly = false,
    allowPrivate = true,
  }: ValidateResolvedHostnameOptions = {}
): Promise<void> {
  const host = normalizeHost(hostname);
  if (isMetadataHost(host)) throw new UsageError('Cloud metadata endpoints are blocked');
  if (!allowPrivate && isPrivateHost(host)) {
    throw new UsageError('Private network addresses are blocked');
  }
  let addresses: DnsLookupEntry[];
  if (net.isIP(host)) {
    addresses = [{ address: host }];
  } else {
    let timer: NodeJS.Timeout | undefined;
    try {
      addresses = await Promise.race([
        Promise.resolve().then(() => lookup(host, { all: true, verbatim: true })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new InspectorError('DNS validation timed out', 'DNS_TIMEOUT')), timeoutMs);
        }),
      ]);
    } catch (error: any) {
      if (error instanceof InspectorError) throw error;
      throw new InspectorError(`DNS validation failed (${error?.code || 'lookup error'})`, 'DNS_LOOKUP_FAILED');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((entry) => !net.isIP(entry.address))) {
    throw new InspectorError('DNS validation returned no valid addresses', 'DNS_LOOKUP_FAILED');
  }
  if (addresses.some((entry) => isMetadataHost(entry.address))) {
    throw new UsageError('Cloud metadata endpoints are blocked by DNS validation');
  }
  if (!allowPrivate && addresses.some((entry) => isPrivateHost(entry.address))) {
    throw new UsageError('Private network addresses are blocked by DNS validation');
  }
  if (loopbackOnly && addresses.some((entry) => !isLoopbackHost(entry.address))) {
    throw new UsageError('--cdp must resolve only to loopback addresses');
  }
}

export async function validateResolvedTargetUrl(raw: unknown, options: ValidateResolvedHostnameOptions = {}): Promise<URL> {
  const url = validateTargetUrl(raw);
  await validateResolvedHostname(url.hostname, options);
  return url;
}

export function validateCdpEndpoint(raw: unknown, allowRemote?: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(String(raw));
  } catch {
    throw new UsageError(`Invalid --cdp endpoint: ${raw}`);
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    throw new UsageError('--cdp must be an http(s) or ws(s) URL');
  }
  if (parsed.username || parsed.password) {
    throw new UsageError('--cdp URLs containing credentials are not allowed');
  }
  if (!allowRemote && !isLoopbackHost(parsed.hostname)) {
    throw new UsageError('--cdp is restricted to loopback endpoints. Pass --allow-remote-cdp to override (unsafe).');
  }
  if (isMetadataHost(parsed.hostname)) {
    throw new UsageError('Cloud metadata endpoints are blocked');
  }
  return parsed;
}

export function validateBrowserArg(arg: unknown): void {
  const lower = String(arg).toLowerCase().split('=')[0].trim();
  if (DANGEROUS_BROWSER_FLAGS.some((bad) => lower === bad || lower.startsWith(`${bad}=`))) {
    throw new UsageError(`Dangerous or disallowed browser argument: ${arg}`);
  }
}
