import type {
  DiffReport,
  FullReport,
  InteractiveItem,
  MinimalSummary,
  NetworkEntry,
} from '../../src/types/report.js';

// Compile-only consumers of the declared developer interface, not automatic emitter verification.
export const page: FullReport['page'] = {
  url: 'https://example.com/',
  title: 'Example',
  metrics: {
    innerWidth: 390,
    innerHeight: 844,
    documentClientWidth: null,
    documentClientHeight: null,
    documentScrollWidth: null,
    documentScrollHeight: null,
    horizontalOverflow: false,
    overflowElements: [],
  },
  scrollLock: {
    htmlOverflowX: 'visible',
    htmlOverflowY: 'visible',
    bodyOverflowX: 'visible',
    bodyOverflowY: 'visible',
    locked: false,
    trapRisk: false,
  },
};

export const dom: FullReport['dom'] = {
  selector: null,
  selectorMatched: true,
  stats: {
    nodes: 3,
    elementNodes: 3,
    textNodes: 1,
    visibleElements: 3,
    hiddenElements: 0,
    maxDepthReached: 2,
  },
  tree: { tag: 'html' },
  truncated: false,
};

export const overflowElement: FullReport['page']['metrics']['overflowElements'][number] = {
  cssPath: 'input#search',
  rect: { top: null, right: 44, bottom: 44, left: null, width: 44, height: 44 },
};

export const input: InteractiveItem = {
  ref: '@e1',
  tag: 'input',
  type: 'text',
  rect: { viewport: overflowElement.rect, document: overflowElement.rect },
};
export const inputType: string | null | undefined = input.type;
export const inputViewportLeft: number | null | undefined = input.rect?.viewport.left;
export const inputDocumentRight: number | null | undefined = input.rect?.document.right;
export const unspecifiedInputType: InteractiveItem['type'] = null;

export const heading: FullReport['headings']['items'][number] = {
  level: 1,
  text: 'Example',
  cssPath: 'h1',
  rect: { viewport: overflowElement.rect, document: overflowElement.rect },
};
export const headingDocumentLeft: number | null | undefined = heading.rect?.document.left;
export const missingHeadingRect: FullReport['headings']['items'][number]['rect'] = null;

export const interactiveSummary: NonNullable<MinimalSummary['interactive']> = {
  total: 1,
  showing: 1,
  items: [{ ref: '@e1', tag: 'input', type: 'text', name: 'Search' }],
};

export const errors: FullReport['errors'] = {
  uncaught: [
    {
      text: 'Uncaught exception',
      url: null,
      lineNumber: null,
      columnNumber: null,
      stack: [{ functionName: null, url: null, lineNumber: 0, columnNumber: 0 }],
    },
  ],
  logErrors: [{ text: 'Failed request', url: null, lineNumber: null, source: null }],
};
export const stackUrl: string | null | undefined = errors.uncaught[0].stack?.[0].url;
export const errorSummary: MinimalSummary['errors'] = {
  uncaughtCount: 1,
  logErrorCount: 1,
  uncaught: errors.uncaught,
  logErrors: errors.logErrors,
};

export const dialogs: FullReport['dialogs'] = [{ type: null, message: 'Example', url: null }];
export const dialogSummary: MinimalSummary['dialogs'] = { count: dialogs.length, items: dialogs };

export const diff: DiffReport = {
  ok: true,
  schemaVersion: '1.0',
  before: 'before-run',
  after: 'after-run',
  summary: { added: 1, removed: 0, layoutChanged: 1, styleChanged: 1, newErrors: 1, newIssues: 0 },
  added: [{ key: 'root0/input[0]' }],
  removed: [],
  layout: [{ key: 'root0/h1[0]', before: overflowElement.rect, after: overflowElement.rect }],
  styles: [
    { key: 'root0/h1[0]', changes: { color: { before: null, after: 'red' } }, rendered: {} },
  ],
  newErrors: errors.uncaught,
  newIssues: [],
  truncated: false,
  note: 'Heuristic structural matching',
};
export const layoutChangeCount: number = diff.summary.layoutChanged;
export const diffViewportLeft: number | null = diff.layout[0].before.left;
export const changedColor: string | null = diff.styles[0].changes.color.after;
export const anonymousDiff: DiffReport = { ...diff, before: undefined, after: undefined };

export const truncation: MinimalSummary['truncated'] = {
  dom: false,
  nodesDropped: 0,
  network: false,
  networkDropped: 0,
  console: false,
  a11y: false,
  storage: false,
  cssVars: false,
  screenshots: false,
};
export const networkDropped: boolean | number | undefined = truncation?.networkDropped;
export const summaryStatus: MinimalSummary['status'] = 'ok';
export const httpFailureStatus: MinimalSummary['status'] = 500;
export const absentHeadings: MinimalSummary['headings'] = null;

export const failedRequest: NetworkEntry = {
  url: 'https://example.com/data',
  method: 'GET',
  status: null,
  statusText: null,
  resourceType: 'Fetch',
  durationMs: null,
  encodedDataLength: null,
  failed: true,
  errorText: 'net::ERR_FAILED',
};
export const completedRequest: NetworkEntry & { durationMs: number } = {
  ...failedRequest,
  status: 200,
  statusText: 'OK',
  durationMs: 420,
  encodedDataLength: 123,
  failed: false,
  errorText: undefined,
};
export const network: NonNullable<FullReport['network']> = {
  requests: [failedRequest, completedRequest],
  summary: {
    total: 2,
    failed: 1,
    statusClasses: { sent: 2, completed: 1, failed: 1, '2xx': 1 },
    byType: { Fetch: 2 },
    truncated: false,
  },
  failures: [failedRequest],
  slowest: [completedRequest],
};
export const resourceType: string | undefined = network.requests[0].resourceType;
export const slowestMethod: string = network.slowest[0].method;
export const slowestDuration: number = network.slowest[0].durationMs;
export const encodedBytes: number | null | undefined = network.slowest[0].encodedDataLength;

export const absentCssVars: FullReport['cssVars'] = null;
export const cssVars: FullReport['cssVars'] = {
  count: 1,
  vars: { '--accent': 'red' },
  truncated: false,
};
export const summarizedCssVars: MinimalSummary['cssVars'] = {
  count: 1,
  vars: { '--accent': 'red' },
  truncated: true,
};
export const frame: FullReport['frames'][number] = {
  id: 'root-frame',
  url: null,
  securityOrigin: null,
};
export const unavailableFontSize: InteractiveItem['fontSize'] = null;

export const fallbackPerformance: MinimalSummary['performance'] = {
  paints: [],
  navigationMs: null,
};
export const budgetedPerformance: MinimalSummary['performance'] = null;
export const webVitals: MinimalSummary['performance'] = {
  lcp: null,
  cls: null,
  fcp: null,
  fid: null,
  inp: null,
};
export const lcp: number | null = webVitals.lcp;
