export type IssueSeverity = 'error' | 'warn' | 'info';

export interface IssueItem {
  code: string;
  severity: IssueSeverity;
  message: string;
  selector?: string;
  details?: Record<string, unknown>;
}

export interface SecurityAudit {
  promptInjectionDetected: boolean;
  threatLevel: 'clean' | 'medium' | 'high' | 'critical';
  notice: string;
  findingsCount: number;
  findings?: Array<{
    id: string;
    severity: string;
    description: string;
    field: string;
    matchedSnippet: string;
  }>;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  statusText?: string;
  type?: string;
  durationMs: number;
  transferSize?: number;
  errorText?: string;
  failed?: boolean;
}

export interface InteractiveItem {
  ref: string;
  tag: string;
  role?: string | null;
  name?: string;
  accessibleName?: string;
  text?: string;
  rendered?: boolean;
  href?: string | null;
  tabIndex?: number;
  disabled?: boolean;
  smallTouchTarget?: boolean;
  fontSize?: string;
  rect?: unknown;
  cssPath?: string;
  [key: string]: unknown;
}

export interface MinimalSummary {
  ok: boolean;
  schemaVersion: '1.0';
  security: SecurityAudit;
  target: {
    requestedUrl: string;
    finalUrl: string;
    title: string | null;
    httpStatus: number | null;
  };
  run: {
    id: string;
    directory: string;
    report: string;
  };
  viewport: {
    width: number;
    height: number;
    dpr: number;
    mobile: boolean;
  };
  durationMs: number;
  performance: {
    lcp: number | null;
    cls: number | null;
    fcp: number | null;
    fid: number | null;
    inp: number | null;
  };
  layout: {
    horizontalOverflow: boolean;
    scrollTrap: boolean;
    nodes: number;
    issueCounts: Record<string, number>;
  };
  issues: IssueItem[];
  network: {
    total: number;
    failed: number;
    statusClasses: Record<string, number>;
    byType?: Record<string, number>;
  } | null;
  console: {
    counts: Record<string, number>;
    errors: Array<{ text: string; url?: string; lineNumber?: number }>;
  };
  errors: {
    uncaughtCount: number;
    logErrorCount: number;
    uncaught: Array<{ text: string; url?: string; lineNumber?: number; stack?: string }>;
    logErrors: Array<{ text: string; url?: string; lineNumber?: number }>;
  };
  dialogs: {
    count: number;
    items: Array<{ type: string; message: string; defaultPrompt?: string }>;
  };
  landmarks: Record<string, { count: number; items?: string[] }>;
  interactive?: {
    total: number;
    showing: number;
    items: Array<{
      ref: string;
      tag: string;
      role?: string;
      name: string;
      rendered?: boolean;
      href?: string;
    }>;
  };
  headings?: {
    count: number;
    items: Array<{ level: number; tag: string; text: string }>;
    outline: string[];
  };
  headingsOutline?: string[];
  dom?: {
    selector: string;
    selectorMatched: boolean;
    tree: unknown;
    stats: unknown;
  };
  cssVars?: {
    count: number;
    vars: Record<string, string>;
  };
  warnings: string[];
  truncated?: boolean;
  matrix?: {
    viewports: Array<{
      viewport: { width: number; height: number };
      issues: number;
      overflow: boolean;
    }>;
    differences: unknown[];
  };
  interactions?: {
    performed: number;
    explored: number;
    diff: unknown | null;
  };
}

export interface DiffReport {
  ok: boolean;
  before: string;
  after: string;
  generatedAt: string;
  summary: {
    newErrors: number;
    resolvedErrors: number;
    newIssues: number;
    resolvedIssues: number;
    layoutChanged: boolean;
    domChanged: boolean;
  };
  differences: {
    errors?: {
      new: unknown[];
      resolved: unknown[];
    };
    issues?: {
      new: unknown[];
      resolved: unknown[];
    };
    page?: Record<string, unknown>;
    dom?: Record<string, unknown>;
    performance?: Record<string, unknown>;
    network?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface FullReport {
  ok: boolean;
  schemaVersion: '1.0';
  tool: { name: string; version: string };
  generatedAt: string;
  durationMs: number | null;
  security: SecurityAudit;
  target: {
    requestedUrl: string;
    finalUrl: string;
    title: string | null;
    httpStatus: number | null;
    mimeType?: string | null;
  };
  environment: {
    browser: string | null;
    protocolVersion: string | null;
    executable: string | null;
    viewport: { width: number; height: number; dpr: number; mobile: boolean };
    touch: boolean;
    userAgent: string | null;
    colorScheme: 'light' | 'dark' | null;
    reducedMotion: 'reduce' | 'no-preference' | null;
    timezone: string | null;
    locale: string | null;
    headers: string[];
  };
  page: {
    url: string;
    title: string;
    metrics: {
      scrollWidth: number;
      scrollHeight: number;
      clientWidth: number;
      clientHeight: number;
      horizontalOverflow: boolean;
      overflowElements: Array<{
        cssPath: string;
        rect: { x: number; y: number; width: number; height: number };
      }>;
    };
    scrollLock: {
      trapRisk: boolean;
      overflowY: string;
      position: string;
      bodyOverflowY: string;
      htmlOverflowY: string;
      contentHeight: number;
      viewportHeight: number;
    };
    navigator?: Record<string, unknown>;
    media?: Record<string, unknown>;
  };
  dom: {
    selector: string;
    selectorMatched?: boolean;
    stats: {
      totalNodes: number;
      elementNodes: number;
      maxDepth: number;
      textBytes: number;
    };
    tree: unknown;
    truncated: boolean;
  };
  landmarks: Record<string, { count: number; items: Array<{ selector: string }> }>;
  headings: {
    count: number;
    items: Array<{
      level: number;
      text: string;
      id?: string;
      cssPath: string;
      rect: unknown | null;
    }>;
    truncated: boolean;
  };
  forms: {
    count: number;
    items: unknown[];
    truncated: boolean;
  };
  interactive: {
    count: number;
    items: InteractiveItem[];
    truncated: boolean;
  };
  images: {
    count: number;
    missingAltCount: number;
    items: unknown[];
    truncated: boolean;
  };
  frames: Array<{ id: string; url: string; securityOrigin: string }>;
  network: {
    requests: NetworkEntry[];
    summary: {
      total: number;
      failed: number;
      statusClasses: Record<string, number>;
      byType: Record<string, number>;
      truncated: boolean;
    };
    failures: Array<{ url: string; status: number; errorText?: string }>;
    slowest: Array<{ url: string; durationMs: number; transferSize: number }>;
  } | null;
  console: {
    entries: Array<{
      type: string;
      text: string;
      timestamp: number;
      url?: string;
      lineNumber?: number;
    }>;
    counts: Record<string, number>;
    truncated: boolean;
  } | null;
  errors: {
    uncaught: Array<{ text: string; stack?: string; url?: string; lineNumber?: number }>;
    logErrors: Array<{ text: string; url?: string; lineNumber?: number }>;
    uncaughtCount: number;
    logErrorCount: number;
  };
  dialogs: {
    count: number;
    items: Array<{ type: string; message: string; defaultPrompt?: string }>;
  };
  a11y?: unknown;
  performance?: unknown;
  storage?: unknown;
  cookies?: unknown;
  cssVars?: {
    count: number;
    vars: Record<string, string>;
  };
  screenshots?: unknown;
  issues: IssueItem[];
  warnings: string[];
  matrix?: unknown;
  interactions?: unknown;
  run: {
    id: string;
    directory: string;
    report: string;
  };
  meta?: Record<string, unknown>;
}

export type DeltaOpKind = 'add' | 'remove' | 'replace';

export interface DeltaOperation {
  op: DeltaOpKind;
  ref: string;
  role?: string;
  name?: string;
  selector?: string;
  tag?: string;
}

export interface InteractiveDelta {
  kind: 'unchanged' | 'delta' | 'full';
  changed: boolean;
  additions: number;
  removals: number;
  replacements?: number;
  unchanged: number;
  changes?: DeltaOperation[];
  diff?: string;
  tree?: string;
}
