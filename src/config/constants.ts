export const TOOL_NAME = 'agentsEye';
export const TOOL_VERSION = '2.2.1';
export const SCHEMA_VERSION = '1.0';

export const REF_PREFIX = '@e';
export const REF_REGEX = /^@e\d+$/i;
export const REF_ATTR = 'data-agentseye-ref';
export const REF_REGISTRY_SLOT = '__agentsEyeRefsV1';
export const DEFAULT_SUMMARY_INTERACTIVE_LIMIT = 12;

export const FOCUS_SLICES = [
  'issues',
  'forms',
  'dom',
  'network',
  'perf',
  'console',
  'storage',
  'interactive',
] as const;

export const TAILWIND_VIEWPORTS = Object.freeze({
  mobile: Object.freeze({ width: 375, height: 667, dpr: 1, mobile: true }),
  sm: Object.freeze({ width: 640, height: 800, dpr: 1, mobile: false }),
  md: Object.freeze({ width: 768, height: 1024, dpr: 1, mobile: false }),
  lg: Object.freeze({ width: 1024, height: 768, dpr: 1, mobile: false }),
  xl: Object.freeze({ width: 1280, height: 800, dpr: 1, mobile: false }),
  '2xl': Object.freeze({ width: 1536, height: 960, dpr: 1, mobile: false }),
});

export const MATRIX_VIEWPORTS = Object.freeze([
  { ...TAILWIND_VIEWPORTS.mobile },
  { ...TAILWIND_VIEWPORTS.sm },
  { ...TAILWIND_VIEWPORTS.md },
  { ...TAILWIND_VIEWPORTS.lg },
  { ...TAILWIND_VIEWPORTS.xl },
  { ...TAILWIND_VIEWPORTS['2xl'] },
]);

export const DEFAULTS = Object.freeze({
  timeoutMs: 30_000,
  waitMs: 400,
  idleMs: 500,
  maxNodes: 3_000,
  maxDepth: 40,
  textLimit: 160,
  attributeLimit: 24,
  pageTextLimit: 2_000,
  maxLandmarks: 40,
  maxHeadings: 120,
  maxForms: 200,
  maxInteractive: 300,
  maxImages: 80,
  maxNetwork: 300,
  maxConsole: 250,
  maxA11y: 1_000,
  maxStorage: 200,
  maxStorageValueLength: 2_000,
  maxCssVars: 200,
  maxIssues: 80,
  viewport: Object.freeze({ width: 375, height: 667, dpr: 1, mobile: true }),
  breakpoints: [320, 360, 375, 412, 640, 768, 1024, 1280, 1536, 1920],
});

export const KNOWN_SECTIONS = new Set([
  'target',
  'environment',
  'page',
  'dom',
  'landmarks',
  'headings',
  'forms',
  'interactive',
  'images',
  'frames',
  'network',
  'console',
  'errors',
  'dialogs',
  'matrix',
  'interactions',
  'run',
  'warnings',
  'a11y',
  'performance',
  'storage',
  'cookies',
  'cssVars',
  'screenshots',
  'issues',
  'meta',
  'security',
]);

export const DEFAULT_STYLE_PROPS = [
  'display',
  'position',
  'visibility',
  'opacity',
  'overflow-x',
  'overflow-y',
  'z-index',
  'font-size',
  'font-family',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'width',
  'height',
  'min-width',
  'max-width',
  'padding',
  'margin',
  'box-sizing',
  'flex-direction',
  'align-items',
  'justify-content',
  'gap',
  'grid-template-columns',
  'transform',
  'pointer-events',
  'white-space',
  'word-break',
  'text-overflow',
];

export const TEXT_KEYS = new Set([
  'text',
  'ownText',
  'textPreview',
  'title',
  'placeholder',
  'ariaLabel',
  'accessibleName',
  'alt',
  'value',
  'message',
  'description',
  'stack',
  'metaDescription',
  'ogTitle',
  'errorText',
  'statusText',
  'note',
  'content',
  'label',
  'reason',
  'detail',
  'srcset',
  'selection',
  'id',
  'selector',
  'name',
  'action',
]);

export const URL_KEYS = new Set([
  'url',
  'finalUrl',
  'requestedUrl',
  'documentUrl',
  'requestUrl',
  'initiatorUrl',
  'href',
  'src',
  'action',
  'canonical',
  'unreachableUrl',
]);

export const SENSITIVE_KEY_RE =
  /(?:^|[^a-z0-9])(?:pass(?:word|wd)?|secret|token|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(?:orization)?|session(?:[_-]?id)?|cookie|csrf|xsrf|private[_-]?key|client[_-]?secret|bearer|signature|sig)(?:$|[^a-z0-9])/i;

export const METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.com',
  'instance-data',
  'fd00:ec2::254',
]);

export const BROWSER_ENV_KEYS = [
  'AGENTSEYE_BROWSER',
  'AGENTS_EYE_BROWSER',
  'RUNTIME_INSPECTOR_BROWSER',
  'CHROME_PATH',
  'CHROME_BIN',
  'EDGE_PATH',
  'BROWSER_PATH',
];

export const DANGEROUS_BROWSER_FLAGS = [
  '--renderer-cmd-prefix',
  '--gpu-launcher',
  '--utility-cmd-prefix',
  '--single-process',
  '--no-sandbox',
  '--disable-web-security',
  '--allow-file-access-from-files',
  '--user-data-dir',
  '--enable-logging',
  '--log-file',
  '--remote-debugging-address',
  '--unsafely-treat-insecure-origin-as-secure',
];

export const LLM_CONTROL_TOKENS: Array<[RegExp, (m: string, role?: string) => string]> = [
  // ChatML tokens
  [
    /<\|(?:im_start|im_end|system|user|assistant|endoftext|fim_prefix|fim_middle|fim_suffix)\|>/gi,
    (m: string) => `[ESCAPED_TOKEN:${m.slice(1, -1)}]`,
  ],
  // LLaMA / Mistral tokens
  [
    /\[\/?(?:INST|SYS|SYSTEM_PROMPT)\]/gi,
    (m: string) => `[ESCAPED_TOKEN:${m.replace(/[\[\]]/g, '')}]`,
  ],
  [/<<\/?SYS>>/gi, (m: string) => `[ESCAPED_TOKEN:${m.replace(/[<>]/g, '')}]`],
  // Turn markers (Claude, Alpaca, Chat turn spoofing)
  [
    /(?:^|\r?\n)\s*(Human|Assistant|System)\s*:/gi,
    (_m: string, role?: string) => `\n[ESCAPED_ROLE:${role}]:`,
  ],
  [
    /(?:^|\r?\n)\s*###\s*(Instruction|Response|System)\s*:/gi,
    (_m: string, role?: string) => `\n### [ESCAPED_ROLE:${role}]:`,
  ],
  // Agent protocol XML tags (prevent breakout from tool result envelopes)
  [
    /<\/?(?:tool_call|tool_result|function_call|system_prompt|antthinking)>/gi,
    (m: string) => `[ESCAPED_TAG:${m.replace(/[<>/]/g, '')}]`,
  ],
];

export interface PromptInjectionPattern {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  regex: RegExp;
  description: string;
}

export const PROMPT_INJECTION_PATTERNS: PromptInjectionPattern[] = [
  // 1. Instruction Resets & Overrides
  {
    id: 'instruction_override',
    severity: 'critical',
    regex:
      /\b(?:ignore|disregard|forget|bypass|override|drop)\s+(?:(?:all|previous|prior|above|existing|system)\s+)+(?:instructions?|directions?|prompts?|rules?|constraints?|commands?)\b|دستورات\s+(?:(?:قبلی|سیستم)\s*)+\s+را\s+(?:فراموش|نادیده)/i,
    description: 'Instruction override directive attempting to reset agent system instructions.',
  },
  {
    id: 'new_system_instructions',
    severity: 'critical',
    regex:
      /\b(?:new|updated|revised)\s+(?:system\s+)?(?:instructions?|prompt|directives?|rules?)\s*[:=]|از\s+این\s+به\s+بعد\s+شما(?:\s|$)/i,
    description: 'Directive attempting to declare new system prompt or rules.',
  },
  {
    id: 'system_mode_switch',
    severity: 'high',
    regex:
      /\b(?:you\s+are\s+now\s+in|switch\s+to|enter)\s+(?:maintenance|developer|debug|god|unrestricted|sudo|admin|dan)\s+mode\b|حالت\s+(?:توسعه[‌\s]?دهنده|مدیر)/i,
    description: 'Attempt to force model into unrestricted/maintenance debug mode.',
  },
  // 2. Shell Command & Exfiltration Lures
  {
    id: 'credential_exfil_lure',
    severity: 'critical',
    regex:
      /\b(?:read|cat|type|exfiltrate|send|upload|post|leak)\s+(?:~[\/\w.-]*\/|\/etc\/|[a-z]:\\|\.)?(?:id_rsa|id_ed25519|\.env|\.aws|\.gitconfig|shadow|passwd|master\.key)\b|(?:فایل\s+\.env|کلیدهای\s+ssh)\s+را\s+(?:بخوان|ارسال)/i,
    description: 'Directive enticing agent to read local keys or environment variables.',
  },
  {
    id: 'shell_execution_lure',
    severity: 'critical',
    regex:
      /\b(?:(?:execute|run|eval)\s+(?:terminal|bash|shell|powershell|cmd|sh|command)\s*[:=]?\s*[`"']?(?:curl|wget|rm\s+-rf|npm\s+i|chmod|cat|python|nc|bash)|(?:curl|wget)\s+https?:\/\/\S+\s*\|\s*(?:bash|sh))\b/i,
    description: 'Direct shell command execution lure embedded in web content.',
  },
  {
    id: 'instruction_concealment',
    severity: 'high',
    regex:
      /\b(?:do\s+not|never)\s+(?:tell|inform|alert|report\s+to)\s+(?:the\s+)?(?:user|developer|operator|human)\b/i,
    description: 'Directive commanding the agent to conceal actions from the user.',
  },
];

export const INVISIBLE_CHARS_REGEX =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:JWT]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]'],
  [/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, '[REDACTED:KEY]'],
  [/\bsk-[A-Za-z0-9]{16,}\b/g, '[REDACTED:KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:KEY]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:KEY]'],
  [/\b(?:tok|key|secret|pat)_[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED:KEY]'],
  [
    /((?:["'])?\b(?:token|secret|password|passwd|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(?:[_-]?token)?|authorization|session[_-]?id|csrf|xsrf)\b(?:["'])?\s*[:=]\s*["']?)([^"'\s,;&<>]{6,})/gi,
    '$1[REDACTED]',
  ],
];
