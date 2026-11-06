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
  status: number | null;
  statusText?: string | null;
  resourceType?: string;
  durationMs: number | null;
  encodedDataLength?: number | null;
  errorText?: string;
  failed?: boolean;
}

interface RectCoordinates {
  top: number | null;
  right: number | null;
  bottom: number | null;
  left: number | null;
  width: number | null;
  height: number | null;
}

interface ElementRect {
  viewport: RectCoordinates;
  document: RectCoordinates;
}

export interface InteractiveItem {
  ref: string;
  tag: string;
  type?: string | null;
  role?: string | null;
  name?: string;
  accessibleName?: string;
  text?: string;
  rendered?: boolean;
  href?: string | null;
  tabIndex?: number;
  disabled?: boolean;
  smallTouchTarget?: boolean;
  fontSize?: string | null;
  rect?: ElementRect;
  cssPath?: string;
  [key: string]: unknown;
}

export interface MinimalSummary {
  ok: boolean;
  status: string | number;
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
  performance:
    | {
        lcp: number | null;
        cls: number | null;
        fcp: number | null;
        fid: number | null;
        inp: number | null;
      }
    | { paints: unknown[]; navigationMs: number | null }
    | null;
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
    uncaught: FullReport['errors']['uncaught'];
    logErrors: FullReport['errors']['logErrors'];
  };
  dialogs: {
    count: number;
    items: FullReport['dialogs'];
  };
  landmarks: Record<string, { count: number; items?: string[] }>;
  interactive?: {
    total: number;
    showing: number;
    items: Array<{
      ref: string;
      tag: string;
      type?: string;
      role?: string;
      name: string;
      href?: string;
    }>;
  };
  headings?: {
    count: number;
    items: Array<{ level: number; tag: string; text: string }>;
    outline: string[];
  } | null;
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
    truncated?: boolean;
  };
  warnings: string[];
  truncated?: Record<string, boolean | number>;
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
  schemaVersion: '1.0';
  before?: string;
  after?: string;
  summary: {
    added: number;
    removed: number;
    layoutChanged: number;
    styleChanged: number;
    newErrors: number;
    newIssues: number;
  };
  added: Array<{ key: string; selector?: string }>;
  removed: Array<{ key: string; selector?: string }>;
  layout: Array<{
    key: string;
    selector?: string;
    before: RectCoordinates;
    after: RectCoordinates;
  }>;
  styles: Array<{
    key: string;
    selector?: string;
    changes: Record<string, { before: string | null; after: string | null }>;
    rendered: { before?: boolean; after?: boolean };
  }>;
  newErrors: unknown[];
  newIssues: unknown[];
  truncated: boolean;
  note: string;
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
      innerWidth: number;
      innerHeight: number;
      documentClientWidth: number | null;
      documentClientHeight: number | null;
      documentScrollWidth: number | null;
      documentScrollHeight: number | null;
      horizontalOverflow: boolean;
      overflowElements: Array<{
        cssPath: string;
        rect: RectCoordinates;
      }>;
    };
    scrollLock: {
      htmlOverflowX: string;
      htmlOverflowY: string;
      bodyOverflowX: string;
      bodyOverflowY: string;
      locked: boolean;
      trapRisk: boolean;
    };
    navigator?: Record<string, unknown>;
    media?: Record<string, unknown>;
  };
  dom: {
    selector: string | null;
    selectorMatched?: boolean;
    stats: {
      nodes: number;
      elementNodes: number;
      textNodes: number;
      visibleElements: number;
      hiddenElements: number;
      maxDepthReached: number;
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
      rect: ElementRect | null;
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
  frames: Array<{ id: string; url: string | null; securityOrigin: string | null }>;
  network: {
    requests: NetworkEntry[];
    summary: {
      total: number;
      failed: number;
      statusClasses: Record<string, number>;
      byType: Record<string, number>;
      truncated: boolean;
    };
    failures: NetworkEntry[];
    slowest: Array<NetworkEntry & { durationMs: number }>;
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
    uncaught: Array<{
      text: string;
      stack?: Array<{
        functionName: string | null;
        url: string | null;
        lineNumber: number;
        columnNumber: number;
      }>;
      url?: string | null;
      lineNumber?: number | null;
      columnNumber?: number | null;
    }>;
    logErrors: Array<{
      text: string;
      url?: string | null;
      lineNumber?: number | null;
      source?: string | null;
    }>;
  };
  dialogs: Array<{ type: string | null; message: string; url?: string | null }>;
  a11y?: unknown;
  performance?: unknown;
  storage?: unknown;
  cookies?: unknown;
  cssVars?: {
    count: number;
    vars: Record<string, string>;
    truncated?: boolean;
  } | null;
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
