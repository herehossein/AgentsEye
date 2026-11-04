export interface ViewportConfig {
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
}

export type ActionType = 'click' | 'hover' | 'scroll' | 'key';

export interface ActionItem {
  type: ActionType;
  selector?: string;
  dx?: number;
  dy?: number;
  key?: string;
  value?: string;
  description?: string;
}

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface InspectorOptions {
  url?: string;
  command?: 'inspect' | 'show' | 'diff' | 'clean' | 'help' | 'version';
  args?: string[];
  cleanAll?: boolean;
  olderThan?: number;
  cleanTargetIds?: string[];
  showTargetId?: string;
  queryPath?: string;
  diffBeforeId?: string;
  diffAfterId?: string;
  viewport: ViewportConfig;
  viewports?: ViewportConfig[];
  matrix?: boolean;
  timeoutMs: number;
  waitMs: number;
  idleMs: number;
  networkIdle: boolean;
  waitForSelector?: string;
  colorScheme?: 'light' | 'dark';
  reducedMotion?: 'reduce' | 'no-preference';
  timezone?: string;
  locale?: string;
  userAgent?: string;
  headers: HeaderEntry[];
  cdp?: string;
  allowRemoteCdp?: boolean;
  browser?: string;
  executablePath?: string;
  browserArgs: string[];
  selector?: string;
  allMatches?: boolean;
  visibleOnly?: boolean;
  noShadowDom?: boolean;
  noIframes?: boolean;
  includeShadowDom?: boolean;
  includeIframes?: boolean;
  includeTemplates?: boolean;
  includeCssVars?: boolean;
  styleProps: string[];
  compactStyles?: boolean;
  maxNodes: number;
  maxDepth: number;
  textLimit: number;
  attributeLimit: number;
  collectA11y?: boolean;
  maxA11yNodes?: number;
  retainNetwork?: boolean;
  retainConsole?: boolean;
  consoleLevel?: string[];
  consoleFilter?: string | RegExp;
  showStorage?: boolean;
  showCookies?: boolean;
  redact: 'none' | 'sensitive' | 'all';
  sanitizeInjections: 'neutralize' | 'warn' | 'none';
  blockedUrlPatterns: string[];
  actions: ActionItem[];
  explore?: boolean;
  maxExplore?: number;
  allowDestructive?: boolean;
  interactiveScope?: string;
  focus?: string;
  full?: boolean;
  format?: 'json' | 'text';
  temp?: boolean;
  ephemeral?: boolean;
  pretty?: boolean;
  out?: string;
  allowOutsideCwd?: boolean;
  screenshot?: string;
  fullPage?: boolean;
  screenshotFormat?: 'png' | 'jpeg' | 'webp';
  screenshotQuality?: number;
  hideScrollbars?: boolean;
  include?: string[];
  exclude?: string[];
  summaryOnly?: boolean;
  quiet?: boolean;
  runsDir?: string;
  testRunsDir?: string;
  cwd?: string;
}

export interface ProbeConfig {
  selector?: string;
  allMatches?: boolean;
  maxNodes: number;
  maxDepth: number;
  textLimit: number;
  attributeLimit: number;
  styleProps: string[];
  compactStyles: boolean;
  visibleOnly?: boolean;
  includeShadowDom?: boolean;
  includeIframes?: boolean;
  includeTemplates?: boolean;
  includeCssVars?: boolean;
  maxCssVars: number;
  maxLandmarks: number;
  maxHeadings: number;
  maxForms: number;
  maxInteractive: number;
  interactiveScope?: string;
  maxImages: number;
  maxStorage: number;
  maxStorageValueLength: number;
  storageMode: 'keys' | 'values';
  pageTextLimit: number;
  breakpoints: readonly number[];
  maxIssues: number;
}
