import {
  TOOL_NAME,
  TOOL_VERSION,
  SCHEMA_VERSION,
  DEFAULTS,
  DEFAULT_STYLE_PROPS,
  KNOWN_SECTIONS,
} from '../config/constants.js';

export function printHelp(): void {
  process.stdout.write(
    `${TOOL_NAME} v${TOOL_VERSION} — universal read-only browser runtime inspector

Usage:
  ${TOOL_NAME}.mjs <url> [options]
  node ${TOOL_NAME}.mjs <url> [options]
  node ${TOOL_NAME}.mjs show <run-id> [slice|property.path]
  node ${TOOL_NAME}.mjs diff <run-id-1> <run-id-2>
  node ${TOOL_NAME}.mjs --diff <run-id-1> <run-id-2>
  node ${TOOL_NAME}.mjs clean <run-id> [<run-id> ...]
  node ${TOOL_NAME}.mjs clean --older-than <duration>
  node ${TOOL_NAME}.mjs clean --all

Target:
  <url>                         http(s) URL to inspect (required)
  --cdp <http-url|ws-url>       Attach to an existing Chromium CDP endpoint
  --allow-remote-cdp            Allow a non-loopback --cdp endpoint (unsafe)
  --browser <path|command>      Chromium browser executable
  --browser-arg <arg>           Repeatable startup argument for newly launched Chromium only;
                                not used with --cdp; denylisted dangerous switches are rejected
  --headed                      Run with a visible browser window
  --no-sandbox                  Pass --no-sandbox to Chromium (unsafe)
  --ignore-certificate-errors   Accept invalid TLS certificates (unsafe)
  --no-proxy                    Do not use the system proxy
  --disable-cache               Disable the browser HTTP cache

Viewport / emulation:
  --viewport <WxH|preset>       Emulated viewport (default ${DEFAULTS.viewport.width}x${DEFAULTS.viewport.height}; presets: mobile, sm, md, lg, xl, 2xl, desktop, tablet)
  --width <px> --height <px>    Individual viewport dimensions
  --dpr <n>                     Device pixel ratio (default 1)
  --mobile                      Mobile emulation flag (default true for mobile-first auditing)
  --desktop, --no-mobile        Disable mobile emulation (desktop mode)
  --touch                       Enable touch emulation
  --user-agent <string>         Override the User-Agent
  --color-scheme <light|dark>   Emulate prefers-color-scheme
  --reduced-motion <reduce|no-preference>
  --timezone <IANA>             Override timezone (e.g. Asia/Tehran)
  --locale <bcp47>              Override locale (e.g. fa-IR)
  --header "Name: Value"        Extra request header (repeatable; exact-origin scoped)

Loading / waiting:
  --timeout <ms>                Navigation and probe timeout (default ${DEFAULTS.timeoutMs})
  --wait-for <css-selector>     Wait until the selector exists
  --wait-ms <ms>                Extra settle time after load (default ${DEFAULTS.waitMs})
  --idle-ms <ms>                Network-idle window (default ${DEFAULTS.idleMs})
  --no-network-idle             Skip the network-idle wait

DOM / styles:
  --selector <css>              Inspect this subtree (default: documentElement)
  --all-matches                 Inspect every match of --selector (root: "roots")
  --max-nodes <n>               Node cap (default ${DEFAULTS.maxNodes})
  --max-depth <n>               DOM traversal depth cap (default ${DEFAULTS.maxDepth})
  --text-limit <n>              Per-node text cap (default ${DEFAULTS.textLimit})
  --attribute-limit <n>         Per-node attribute cap (default ${DEFAULTS.attributeLimit})
  --style-props <list|none>     Comma-separated CSS properties (camelCase accepted);
                                default: ${DEFAULT_STYLE_PROPS.length} common properties
  --visible-only                Omit hidden subtrees
  --no-shadow-dom               Do not traverse open shadow roots
  --no-iframes                  Do not expand same-origin iframe DOMs
  --include-templates           Traverse <template> contents
  --no-css-vars                 Do not collect CSS custom properties
  --a11y                        Collect the full accessibility tree (opt-in)
  --max-a11y-nodes <n>          Accessibility node cap (default ${DEFAULTS.maxA11y})

Data:
  --no-network                  Do not retain network entries (idle still observed)
  --no-console                  Disable console/exception capture
  --console-level <levels>      Filter console entries: error,warn,info,log,debug,all (comma-separated)
  --console-filter <pattern>    Filter console entries by case-insensitive text or /regex/
  --storage                     Include localStorage/sessionStorage values (redacted)
  --cookies                     Include cookie values (redacted)
  --redact <none|sensitive|all> Redaction mode (default sensitive; "all" also
                                masks emails/phones; "none" is dangerous)
  --sanitize-injections <neutralize|warn|none>
                                Indirect Prompt Injection defense mode (default: neutralize)
  --no-sanitize-injections      Disable prompt injection sanitization (unsafe)
  --block <url-pattern>         Block a URL pattern (repeatable; intercepts all request types)

Interactions (opt-in; can cause application side effects):
  --click <sel|@eN|eN>          Native click after safety and hit-test checks
  --hover <sel|@eN|eN>          Native pointer hover
  --scroll <X,Y|sel|@eN|eN>     Native wheel deltas or scroll into view
  --key <name>                  Safe navigation key, Tab, Escape, Enter or Space
  --interactive-scope <css>     Scope interactive elements collection to selector
  --explore                     Conservatively click toggles/tabs and record diffs
  --max-explore <n>             Exploration click cap (default 8, maximum 50)
  --allow-destructive           Disable destructive-label blacklist only

Responsive analysis:
  --matrix                      Inspect Tailwind breakpoints: mobile, sm, md, lg, xl, 2xl
  --viewports <list>            Inspect comma-separated list of viewports or presets (e.g. 375x667,sm,lg)
  --diff <run-1> <run-2>       Compare two saved reports without navigation

Output:
  --focus <slice>              issues|forms|dom|network|perf|console|storage|interactive
  --console-filter <pattern>   Filter console entries by substring or tag
  --compact, -c                 Prune structural wrappers from interactive tree
  --depth <n>                   Compact interactive tree display depth (integer 0-100; default unset)
                                (--focus interactive --compact); not DOM traversal (--max-depth);
                                collected interactive.items remain unchanged
  --delta                       Emit snapshot delta or unchanged state
  --max-output <n>              Cap serialized character prefix (default ${DEFAULTS.maxOutput});
                                continuation hint and boundary framing are extra
  --no-max-output               Disables only the stdout serialization cap;
                                summary sampling and collection limits remain; does not enable --full
  --content-boundaries          Textual CSPRNG nonce framing (not raw JSON)
  --full                       Emit the comprehensive report to stdout
  --format <json|text>          JSON (compact by default) or clean human-readable plain text
                                Truncated JSON is not parseable; use narrow --no-max-output queries or saved JSON
  --temp                        Save artifacts to the OS temporary directory instead of .agentsEye/runs/
  --ephemeral                   Automatically purge run directory immediately after output completes
  --pretty                      Pretty-print JSON
  --out <path>                  Also write comprehensive report to a new file
  --allow-outside-cwd           Allow --out/--screenshot outside current directory
  --screenshot <path>           Also copy first viewport screenshot to this path
  --full-page                   Capture full-page screenshot
  --screenshot-format <fmt>     png|jpeg|webp (default png)
  --screenshot-quality <n>      Quality for jpeg/webp (0-100)
  --hide-scrollbars             Pass --hide-scrollbars (changes layout)
  --include <sections>          Full-report sections to include
  --exclude <sections>          Full-report sections to exclude
  --summary-only                Explicit compact-summary mode
  --quiet                       Suppress informational stderr output
  -h, --help                    Show this help
  -V, --version                 Show the version

Sections: ${Array.from(KNOWN_SECTIONS).join(', ')}

Output schema (v${SCHEMA_VERSION}): a single JSON object with
  ok, schemaVersion, tool, generatedAt, durationMs,
  target { requestedUrl, finalUrl, title, httpStatus },
  environment { browser, protocolVersion, viewport, userAgent, ... },
  page { url, title, metrics, scrollLock, navigator, media, ... },
  dom { selector, selectorMatched, stats, tree, truncated },
  landmarks, headings, forms, interactive, images, frames,
  network { requests, summary, failures, slowest },
  console { entries, counts }, errors, dialogs,
  a11y (opt-in), performance, storage, cookies, cssVars,
  screenshots, issues, warnings, meta.

Security notes:
  - Passive/read-only by default; JavaScript dialogs are dismissed.
  - Explicit interaction flags authorize inputs and may cause side effects.
  - DNS preflight blocks known cloud metadata and IPv4 link-local destinations,
    but is not DNS pinning. Use network isolation for hostile pages or SSRF-sensitive testing.
  - Document interception is on by default; --header/--block extend it to all request types.
  - --header custom values are exact-origin scoped to the initial target.
  - --cdp creates an isolated incognito target and rejects page WebSockets.
  - Artifacts default to .agentsEye/runs/; --temp uses the OS temp directory,
    and --ephemeral purges the run directory after output. JSON redaction
    follows --redact. Screenshots are unredacted page pixels.
    Cross-origin frames are not expanded.
`,
  );
}
