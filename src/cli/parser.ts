import { UsageError } from '../errors/errors.js';
import { validateBrowserArg } from '../security/url-guard.js';
import { validateRunId } from '../security/path-guard.js';
import {
  DEFAULTS,
  DEFAULT_STYLE_PROPS,
  FOCUS_SLICES,
  KNOWN_SECTIONS,
  REF_REGEX,
  TAILWIND_VIEWPORTS,
} from '../config/constants.js';
import type { ViewportConfig } from '../types/options.js';

export function parseInteger(
  value: any,
  name: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${name} expects an integer between ${min} and ${max}`);
  }
  return n;
}

export function parseEnum<T extends string>(
  value: any,
  name: string,
  allowed: readonly T[] | T[],
): T {
  const normalized = String(value).toLowerCase() as T;
  if (!allowed.includes(normalized)) {
    throw new UsageError(`${name} expects one of: ${allowed.join(', ')}`);
  }
  return normalized;
}

export function parseViewport(value: any): ViewportConfig {
  const trimmed = String(value).trim();
  const lower = trimmed.toLowerCase();
  if (Object.hasOwn(TAILWIND_VIEWPORTS, lower)) {
    return { ...(TAILWIND_VIEWPORTS as Record<string, ViewportConfig>)[lower] };
  }
  const match = /^(\d+)x(\d+)$/i.exec(trimmed);
  if (!match) {
    throw new UsageError(
      '--viewport expects WIDTHxHEIGHT (e.g. 375x667) or preset (mobile, sm, md, lg, xl, 2xl)',
    );
  }
  const width = parseInteger(match[1], '--viewport width', { min: 1, max: 20_000 });
  const height = parseInteger(match[2], '--viewport height', { min: 1, max: 20_000 });
  return {
    width,
    height,
    dpr: 1,
    mobile: width < 768,
  };
}

export function parseHeader(value: any): { name: string; value: string } {
  const index = String(value).indexOf(':');
  if (index <= 0) throw new UsageError('--header expects "Name: Value"');
  const name = String(value).slice(0, index).trim();
  const headerValue = String(value)
    .slice(index + 1)
    .trim();
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
    throw new UsageError(`Invalid header name: ${name}`);
  }
  if (/[\r\n]/.test(headerValue)) {
    throw new UsageError('Header values may not contain CR/LF');
  }
  return { name, value: headerValue };
}

export function normalizeStyleProp(prop: any): string {
  const kebab = String(prop)
    .trim()
    .replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  if (!/^-?[a-z][a-z0-9-]*$/.test(kebab)) {
    throw new UsageError(`Invalid CSS property name: ${prop}`);
  }
  return kebab;
}

export function parseList(value: any): string[] {
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseDuration(value: any): number {
  const match = /^(\d+(?:\.\d+)?)\s*([smhd])$/i.exec(String(value).trim());
  if (!match) {
    throw new UsageError(`Invalid duration "${value}". Expected format like 30m, 1h, 2d`);
  }
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return num * multipliers[unit];
}

export function validateElementLocator(val: any, flag: string): string {
  const trimmed = String(val ?? '').trim();
  if (!trimmed) {
    throw new UsageError(`${flag} expects a non-empty selector or @eN locator`);
  }
  if (trimmed.startsWith('--')) {
    throw new UsageError(`${flag} expects a selector or @eN locator, received flag: ${trimmed}`);
  }
  if (/^e\d+$/i.test(trimmed)) {
    return `@${trimmed.toLowerCase()}`;
  }
  if (trimmed.startsWith('@')) {
    if (!REF_REGEX.test(trimmed)) {
      throw new UsageError(
        `Invalid element ref for ${flag}: ${val}. Expected @e<number> (e.g. @e1)`,
      );
    }
    return trimmed;
  }
  return trimmed;
}

export function validateScrollLocator(val: any): string {
  const trimmed = String(val ?? '').trim();
  if (!trimmed) {
    throw new UsageError('--scroll expects X,Y deltas or an element locator');
  }
  const deltaMatch =
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(trimmed);
  if (deltaMatch) {
    return trimmed;
  }
  return validateElementLocator(trimmed, '--scroll');
}

export interface ParsedArgs {
  url: string | null;
  help: boolean;
  version: boolean;
  cdp: string | null;
  allowRemoteCdp: boolean;
  browser: string | null;
  headed: boolean;
  noSandbox: boolean;
  ignoreCertificateErrors: boolean;
  noProxy: boolean;
  disableCache: boolean;
  viewport: ViewportConfig;
  explicitMobile: boolean;
  customViewports: ViewportConfig[] | null;
  touch: boolean;
  userAgent: string | null;
  colorScheme: 'light' | 'dark' | null;
  reducedMotion: 'reduce' | 'no-preference' | null;
  timezone: string | null;
  locale: string | null;
  headers: Array<{ name: string; value: string }>;
  timeoutMs: number;
  waitFor: string | null;
  waitMs: number;
  idleMs: number;
  networkIdle: boolean;
  selector: string | null;
  allMatches: boolean;
  maxNodes: number;
  maxDepth: number;
  textLimit: number;
  attributeLimit: number;
  styleProps: string[];
  compactStyles: boolean;
  visibleOnly: boolean;
  includeShadowDom: boolean;
  includeIframes: boolean;
  includeTemplates: boolean;
  includeCssVars: boolean;
  a11y: boolean;
  maxA11y: number;
  maxNetwork: number;
  maxConsole: number;
  network: boolean;
  console: boolean;
  consoleLevel: string[] | null;
  consoleFilter: string | null;
  showStorage: boolean;
  showCookies: boolean;
  redact: 'none' | 'sensitive' | 'all';
  block: string[];
  format: 'json' | 'text';
  pretty: boolean;
  out: string | null;
  allowOutsideCwd: boolean;
  screenshot: string | null;
  fullPage: boolean;
  screenshotFormat: 'png' | 'jpeg' | 'webp';
  screenshotQuality: number;
  hideScrollbars: boolean;
  include: string[] | null;
  exclude: string[] | null;
  summaryOnly: boolean;
  full: boolean;
  focus: string | null;
  command: 'inspect' | 'show' | 'diff' | 'clean';
  runIds: string[];
  query: string | null;
  matrix: boolean;
  explore: boolean;
  allowDestructive: boolean;
  maxExplore: number;
  interactiveScope: string | null;
  actions: Array<{ type: string; value: string; selector?: string }>;
  quiet: boolean;
  temp: boolean;
  ephemeral: boolean;
  sanitizeInjections: 'neutralize' | 'warn' | 'none';
  extraBrowserArgs: string[];
  cleanRunIds: string[] | null;
  cleanOlderThan: number | null;
  cleanAll: boolean;
  [key: string]: any;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const options: ParsedArgs = {
    url: null,
    help: false,
    version: false,
    cdp: null,
    allowRemoteCdp: false,
    browser: null,
    headed: false,
    noSandbox: false,
    ignoreCertificateErrors: false,
    noProxy: false,
    disableCache: false,
    viewport: { ...DEFAULTS.viewport },
    explicitMobile: false,
    customViewports: null,
    touch: false,
    userAgent: null,
    colorScheme: null,
    reducedMotion: null,
    timezone: null,
    locale: null,
    headers: [],
    timeoutMs: DEFAULTS.timeoutMs,
    waitFor: null,
    waitMs: DEFAULTS.waitMs,
    idleMs: DEFAULTS.idleMs,
    networkIdle: true,
    selector: null,
    allMatches: false,
    maxNodes: DEFAULTS.maxNodes,
    maxDepth: DEFAULTS.maxDepth,
    textLimit: DEFAULTS.textLimit,
    attributeLimit: DEFAULTS.attributeLimit,
    styleProps: [...DEFAULT_STYLE_PROPS],
    compactStyles: true,
    visibleOnly: false,
    includeShadowDom: true,
    includeIframes: true,
    includeTemplates: false,
    includeCssVars: true,
    a11y: false,
    maxA11y: DEFAULTS.maxA11y,
    maxNetwork: DEFAULTS.maxNetwork,
    maxConsole: DEFAULTS.maxConsole,
    network: true,
    console: true,
    consoleLevel: null,
    consoleFilter: null,
    showStorage: false,
    showCookies: false,
    redact: 'sensitive',
    block: [],
    format: 'json',
    pretty: false,
    out: null,
    allowOutsideCwd: false,
    screenshot: null,
    fullPage: false,
    screenshotFormat: 'png',
    screenshotQuality: 90,
    hideScrollbars: false,
    include: null,
    exclude: null,
    summaryOnly: false,
    full: false,
    focus: null,
    command: 'inspect',
    runIds: [],
    query: null,
    matrix: false,
    explore: false,
    allowDestructive: false,
    maxExplore: 8,
    interactiveScope: null,
    actions: [],
    quiet: false,
    temp: false,
    ephemeral: false,
    sanitizeInjections: 'neutralize',
    extraBrowserArgs: [],
    cleanRunIds: null,
    cleanOlderThan: null,
    cleanAll: false,
    compact: DEFAULTS.compact,
    delta: DEFAULTS.delta,
    depth: null,
    contentBoundaries: DEFAULTS.contentBoundaries,
    maxOutput: DEFAULTS.maxOutput,
  };

  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '-V' || arg === '--version') {
      options.version = true;
      continue;
    }
    if (arg === '-c') {
      options.compact = true;
      continue;
    }
    if (arg.startsWith('--browser-arg=')) {
      const val = arg.slice('--browser-arg='.length);
      validateBrowserArg(val);
      options.extraBrowserArgs.push(val);
      continue;
    }
    if (arg === '--browser-arg') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError('--browser-arg expects a value');
      validateBrowserArg(value);
      options.extraBrowserArgs.push(value);
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new UsageError(`Unknown short option: ${arg}`);
    }

    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const take = (name = `--${key}`): string => {
      if (inline !== undefined) return inline;
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${name} expects a value`);
      return value;
    };

    switch (key) {
      case 'cdp':
        options.cdp = take();
        break;
      case 'allow-remote-cdp':
        options.allowRemoteCdp = true;
        break;
      case 'browser':
        options.browser = take();
        break;
      case 'headed':
        options.headed = true;
        break;
      case 'no-sandbox':
        options.noSandbox = true;
        break;
      case 'ignore-certificate-errors':
        options.ignoreCertificateErrors = true;
        break;
      case 'no-proxy':
        options.noProxy = true;
        break;
      case 'disable-cache':
        options.disableCache = true;
        break;
      case 'viewport': {
        const v = parseViewport(take());
        options.viewport.width = v.width;
        options.viewport.height = v.height;
        if (!options.explicitMobile && v.mobile !== undefined) {
          options.viewport.mobile = v.mobile;
        }
        break;
      }
      case 'width': {
        const w = parseInteger(take(), '--width', { min: 1, max: 20_000 });
        options.viewport.width = w;
        if (!options.explicitMobile) {
          options.viewport.mobile = w < 768;
        }
        break;
      }
      case 'height':
        options.viewport.height = parseInteger(take(), '--height', { min: 1, max: 20_000 });
        break;
      case 'dpr': {
        const dpr = Number(take());
        if (!Number.isFinite(dpr) || dpr <= 0 || dpr > 10) {
          throw new UsageError('--dpr expects a number between 0 and 10');
        }
        options.viewport.dpr = dpr;
        break;
      }
      case 'mobile':
        options.viewport.mobile = true;
        options.explicitMobile = true;
        break;
      case 'desktop':
      case 'no-mobile':
        options.viewport.mobile = false;
        options.explicitMobile = true;
        break;
      case 'viewports': {
        const raw = take();
        const parts = parseList(raw);
        if (parts.length === 0) {
          throw new UsageError(
            '--viewports expects a comma-separated list of viewports or presets',
          );
        }
        options.customViewports = parts.map((part) => {
          const parsed = parseViewport(part);
          return {
            width: parsed.width,
            height: parsed.height,
            dpr: parsed.dpr ?? options.viewport.dpr ?? 1,
            mobile: parsed.mobile ?? parsed.width < 768,
          };
        });
        options.matrix = true;
        break;
      }
      case 'touch':
        options.touch = true;
        break;
      case 'user-agent':
        options.userAgent = take();
        break;
      case 'color-scheme':
        options.colorScheme = parseEnum(take(), '--color-scheme', ['light', 'dark'] as const);
        break;
      case 'reduced-motion':
        options.reducedMotion = parseEnum(take(), '--reduced-motion', [
          'reduce',
          'no-preference',
        ] as const);
        break;
      case 'timezone':
        options.timezone = take();
        break;
      case 'locale':
        options.locale = take();
        break;
      case 'header':
        options.headers.push(parseHeader(take()));
        break;
      case 'timeout':
        options.timeoutMs = parseInteger(take(), '--timeout', { min: 100, max: 600_000 });
        break;
      case 'wait-for':
        options.waitFor = take();
        break;
      case 'wait-ms':
        options.waitMs = parseInteger(take(), '--wait-ms', { min: 0, max: 120_000 });
        break;
      case 'idle-ms':
        options.idleMs = parseInteger(take(), '--idle-ms', { min: 0, max: 120_000 });
        break;
      case 'no-network-idle':
        options.networkIdle = false;
        break;
      case 'selector':
        options.selector = take();
        break;
      case 'all-matches':
        options.allMatches = true;
        break;
      case 'max-nodes':
        options.maxNodes = parseInteger(take(), '--max-nodes', { min: 1, max: 200_000 });
        break;
      case 'max-depth':
        options.maxDepth = parseInteger(take(), '--max-depth', { min: 1, max: 500 });
        break;
      case 'text-limit':
        options.textLimit = parseInteger(take(), '--text-limit', { min: 0, max: 20_000 });
        break;
      case 'attribute-limit':
        options.attributeLimit = parseInteger(take(), '--attribute-limit', { min: 0, max: 500 });
        break;
      case 'style-props': {
        const raw = take();
        options.compactStyles = false;
        options.styleProps =
          raw.toLowerCase() === 'none' ? [] : parseList(raw).map(normalizeStyleProp);
        break;
      }
      case 'visible-only':
        options.visibleOnly = true;
        break;
      case 'no-shadow-dom':
        options.includeShadowDom = false;
        break;
      case 'no-iframes':
        options.includeIframes = false;
        break;
      case 'include-templates':
        options.includeTemplates = true;
        break;
      case 'css-vars':
        options.includeCssVars = true;
        break;
      case 'a11y':
        options.a11y = true;
        break;
      case 'max-a11y-nodes':
        options.maxA11y = parseInteger(take(), '--max-a11y-nodes', { min: 1, max: 100_000 });
        break;
      case 'no-network':
        options.network = false;
        break;
      case 'no-console':
        options.console = false;
        break;
      case 'console-level': {
        const raw = take();
        const validLevels = ['error', 'warn', 'warning', 'info', 'log', 'debug', 'all'];
        const list = parseList(raw).map((lvl) => lvl.toLowerCase());
        if (!list.length) throw new UsageError('--console-level expects comma-separated levels');
        for (const item of list) {
          if (!validLevels.includes(item)) {
            throw new UsageError(
              `Invalid --console-level "${item}". Valid: error, warn, info, log, debug, all`,
            );
          }
        }
        options.consoleLevel = list.includes('all') ? null : list;
        break;
      }
      case 'console-filter': {
        const raw = take();
        if (!raw.trim())
          throw new UsageError('--console-filter expects a non-empty string or regex');
        if (/^\/(.+)\/([a-z]*)$/i.test(raw)) {
          const m = /^\/(.+)\/([a-z]*)$/i.exec(raw)!;
          try {
            new RegExp(m[1], m[2]);
          } catch (err: any) {
            throw new UsageError(`Invalid regex in --console-filter: ${err.message}`);
          }
        }
        options.consoleFilter = raw;
        break;
      }
      case 'storage':
        options.showStorage = true;
        break;
      case 'cookies':
        options.showCookies = true;
        break;
      case 'redact':
        options.redact = parseEnum(take(), '--redact', ['none', 'sensitive', 'all'] as const);
        break;
      case 'sanitize-injections':
        options.sanitizeInjections = parseEnum(take(), '--sanitize-injections', [
          'neutralize',
          'warn',
          'none',
        ] as const);
        break;
      case 'no-sanitize-injections':
        options.sanitizeInjections = 'none';
        break;
      case 'block':
        options.block.push(take());
        break;
      case 'format':
        options.format = parseEnum(take(), '--format', ['json', 'text'] as const);
        break;
      case 'pretty':
        options.pretty = true;
        break;
      case 'out':
        options.out = take();
        break;
      case 'allow-outside-cwd':
        options.allowOutsideCwd = true;
        break;
      case 'screenshot':
        options.screenshot = take();
        break;
      case 'full-page':
        options.fullPage = true;
        break;
      case 'screenshot-format':
        options.screenshotFormat = parseEnum(take(), '--screenshot-format', [
          'png',
          'jpeg',
          'webp',
        ] as const);
        break;
      case 'screenshot-quality':
        options.screenshotQuality = parseInteger(take(), '--screenshot-quality', {
          min: 0,
          max: 100,
        });
        break;
      case 'hide-scrollbars':
        options.hideScrollbars = true;
        break;
      case 'include':
      case 'only':
        options.include = parseList(take());
        break;
      case 'exclude':
      case 'skip':
        options.exclude = parseList(take());
        break;
      case 'summary-only':
        options.summaryOnly = true;
        break;
      case 'focus':
        options.focus = parseEnum(take(), '--focus', FOCUS_SLICES);
        if (options.focus === 'storage') {
          options.showStorage = true;
        }
        break;
      case 'full':
        options.full = true;
        break;
      case 'matrix':
        options.matrix = true;
        break;
      case 'explore':
        options.explore = true;
        break;
      case 'allow-destructive':
        options.allowDestructive = true;
        break;
      case 'max-explore':
        options.maxExplore = parseInteger(take(), '--max-explore', { min: 1, max: 50 });
        break;
      case 'click':
      case 'hover': {
        const val = validateElementLocator(take(), `--${key}`);
        options.actions.push({ type: key, value: val, selector: val });
        break;
      }
      case 'scroll': {
        const val = validateScrollLocator(take());
        options.actions.push({ type: 'scroll', value: val });
        break;
      }
      case 'interactive-scope': {
        const val = take();
        if (!val || !val.trim()) {
          throw new UsageError('--interactive-scope expects a selector');
        }
        options.interactiveScope = val.trim();
        break;
      }
      case 'key':
        options.actions.push({ type: key, value: take() });
        break;
      case 'diff':
        options.command = 'diff';
        options.runIds = [take(), argv[++i]];
        if (!options.runIds[1]) throw new UsageError('--diff expects two run IDs');
        break;
      case 'temp':
        options.temp = true;
        break;
      case 'ephemeral':
        options.ephemeral = true;
        break;
      case 'quiet':
        options.quiet = true;
        break;
      case 'all':
        options.cleanAll = true;
        break;
      case 'older-than':
        options.cleanOlderThan = parseDuration(take());
        break;
      case 'compact':
        options.compact = true;
        break;
      case 'delta':
        options.delta = true;
        break;
      case 'depth':
        options.depth = parseInteger(take(), '--depth', { min: 0, max: 100 });
        break;
      case 'content-boundaries':
        options.contentBoundaries = true;
        break;
      case 'no-max-output':
        options.maxOutput = 0;
        break;
      case 'max-output': {
        const val = take();
        if (!val || !/^\d+$/.test(val)) {
          throw new UsageError(`--max-output requires a positive integer, received: "${val}"`);
        }
        const parsed = parseInt(val, 10);
        if (parsed <= 0) {
          throw new UsageError(`--max-output must be greater than 0, received: ${parsed}`);
        }
        options.maxOutput = parsed;
        break;
      }
      default:
        throw new UsageError(`Unknown option: --${key}`);
    }
  }

  if (options.help || options.version) return options;

  for (const section of [...(options.include ?? []), ...(options.exclude ?? [])]) {
    if (!KNOWN_SECTIONS.has(section)) {
      throw new UsageError(
        `Unknown section "${section}". Known: ${Array.from(KNOWN_SECTIONS).join(', ')}`,
      );
    }
  }
  if (positionals[0] === 'clean') {
    if (options.command !== 'inspect') {
      throw new UsageError('Cannot combine clean with another command');
    }
    const runIds = positionals.slice(1);
    const hasRunIds = runIds.length > 0;
    const hasOlderThan = options.cleanOlderThan != null;
    const hasAll = options.cleanAll === true;

    const countModes = (hasRunIds ? 1 : 0) + (hasOlderThan ? 1 : 0) + (hasAll ? 1 : 0);

    if (countModes === 0) {
      throw new UsageError(
        'Usage: clean <run-id> [<run-id> ...] | clean --older-than <duration> | clean --all',
      );
    }
    if (countModes > 1) {
      throw new UsageError('clean accepts either run IDs, --older-than, or --all (not multiple)');
    }

    if (hasRunIds) {
      options.cleanRunIds = runIds.map(validateRunId);
    }
    options.command = 'clean';
  } else if (positionals[0] === 'show') {
    if (positionals.length < 2 || positionals.length > 3 || options.command !== 'inspect') {
      throw new UsageError('Usage: show <run-id> [slice|section.path]');
    }
    options.command = 'show';
    options.runIds = [positionals[1]];
    options.query = positionals[2] ?? options.focus;
  } else if (positionals[0] === 'diff') {
    if (positionals.length !== 3 || options.command !== 'inspect') {
      throw new UsageError('Usage: diff <run-id-1> <run-id-2>');
    }
    options.command = 'diff';
    options.runIds = positionals.slice(1);
  } else if (options.command === 'diff') {
    if (positionals.length) throw new UsageError('--diff does not accept a target URL');
  } else {
    if (positionals.length !== 1)
      throw new UsageError('One target URL is required. Run --help for usage.');
    options.url = positionals[0];
  }
  for (const id of options.runIds) validateRunId(id);
  if (options.fullPage && !options.screenshot && options.command !== 'inspect') {
    throw new UsageError('--full-page is only available for inspection');
  }
  if (options.summaryOnly && (options.full || options.focus || options.include)) {
    throw new UsageError('--summary-only cannot be combined with --full, --focus or --include');
  }
  if (options.command !== 'clean' && (options.cleanAll || options.cleanOlderThan != null)) {
    throw new UsageError('--all and --older-than are only supported with the clean command');
  }
  if (options.allowDestructive && !options.explore && !options.actions.length) {
    throw new UsageError('--allow-destructive requires --explore or an explicit interaction');
  }
  if (options.actions.length > 50)
    throw new UsageError('At most 50 explicit interactions are allowed');
  for (const action of options.actions) {
    if (!action.value.trim()) throw new UsageError(`--${action.type} expects a non-empty value`);
    if (action.type === 'scroll') {
      const isDelta = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(action.value.trim());
      if (!isDelta) {
        if (action.value.trim().startsWith('@')) {
          if (!REF_REGEX.test(action.value.trim())) {
            throw new UsageError(
              `Invalid element ref for --scroll: ${action.value}. Expected @e<number> (e.g. @e1)`,
            );
          }
        }
      }
    }
  }
  return options;
}
