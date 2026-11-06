# agentsEye repository instructions

> **Project**: `agentsEye` v2.2.1

## Development

- Runtime Node >=22; locked ESLint needs Node `^22.13.0 || >=24`. Install existing dev tools with `npm ci`; no new runtime dependencies.
- From repo root, verify source/skill/reference changes with `npm run typecheck` → `npm run lint` → `npm run format:check` → `npm test`. `npm test` builds then runs `dev/tests/*.test.mjs`; esbuild alone skips typechecking.
- Focused suite: `npm run build`, then `node --test dev/tests/cli-and-queries.test.mjs`. Docs: `node --test dev/tests/docs.test.mjs`; one test: `node --test --test-name-pattern="SSOT" dev/tests/docs.test.mjs`.
- Lint/format scripts only target `src/`. Typecheck also checks compile-only `dev/tests/public-report-types.test.ts`, which `npm test` does not execute.
- Browser integrations start loopback HTTP fixtures and skip without installed Chromium. Set `AGENTSEYE_BROWSER` to the executable for nonstandard installs.

## Code boundaries

- Edit `src/`, not generated `dist/agentsEye.mjs`; `npm run build` creates the ignored bundle for GitHub Releases. Never commit build output. Tests import/spawn this bundle. Build uses `packages: 'external'`; npm runtime imports break standalone portability.
- `src/index.ts` is public exports + guarded CLI entrypoint; `src/inspector/main.ts` owns command/browser/run lifecycle; `src/inspector/inspect-page.ts` aggregates CDP/probes/interactions then redacts/sanitizes.
- Browser-evaluated functions in `src/probes/` run via `.toString()`: no imported runtime helpers or captured module variables; pass config explicitly.
- Preserve public exports and JSON compatibility. Emitters use `any`; align output tests, `src/types/report.ts` and `references/schema-reference.md` when changing telemetry.
- Preserve browser process-tree/profile cleanup and CDP listener/request-guard disposal on failures and signals.

## Documentation

- Build checks `package.json.version` against `TOOL_VERSION` in `src/config/constants.ts`; docs tests require this Project header and both README version badges to match, and check the focus/flag/SSRF guidance below.
- `SKILL.md` must stay <=16,384 bytes. Keep relative links valid, including when only `SKILL.md`, `agentsEye.mjs` and `references/` are copied. `docs/` is ignored/not packaged.
- Installed-skill CLI examples use `node agentsEye.mjs`; from repo root use `node dist/agentsEye.mjs` after building, not package runners. Release ZIPs contain `agentsEye.mjs` from `dist/`, `SKILL.md` and `references/` together in `agents-eye/`; install the extracted folder. No numeric token estimates or absolute security guarantees.

## Inspector pitfalls

- Use `node dist/agentsEye.mjs <url> --temp`; `show`/`diff` find temp runs automatically. `--ephemeral` deletes runs on exit, preventing follow-up queries/diffs.
- Clean only task IDs with `node dist/agentsEye.mjs clean <id>`; broad clean modes include shared OS-temp/legacy roots. Bare `clean` deletes nothing and exits `2`.
- Exit `0`/`report.ok === true` means inspection completed, not a clean page. Inspect `issues`, `network.failures`, `errors.uncaught`. Exit `1`: runtime/DNS failure; `2`: usage/SSRF-policy rejection.
- For web bugfixes, use before/after runs and `node dist/agentsEye.mjs diff <before-id> <after-id>`; require `summary.newErrors === 0` and `summary.newIssues === 0`, and check the original defect.
- Avoid `--full` stdout; use `--focus` or `node dist/agentsEye.mjs show <id> <dotted.path>`. Slices available: `issues`, `forms`, `dom`, `network`, `perf`, `console`, `storage`, `interactive`.
- `--depth` (0–100) limits tree display with `--focus interactive --compact`, not DOM traversal (`--max-depth`) or collected items. `--no-max-output` removes only the serialization cap, not summary/collection limits; it does not enable `--full`.
- `--browser-arg` is repeatable and affects newly launched Chromium only, never `--cdp`; preserve its dangerous-switch denylist.
- In PowerShell quote refs (`--click '@e1'`) or use bare `e1`; unquoted `@e1` is splatting.
- `--cdp` creates a fresh incognito context/tab, not existing authenticated tabs; non-loopback requires `--allow-remote-cdp`. Custom `--header` values apply only to the exact initial origin; matching names are stripped cross-origin.
- Private and loopback targets are allowed except blocked metadata/IPv4 link-local addresses. Preflight does not blanket-block IPv6 link-local or non-metadata IPv4-mapped IPv6 addresses. No DNS pinning/rebinding guarantee; see `references/security-model.md`.
- `--allow-destructive` relaxes only the English/Persian keyword filter, not navigation, submit/reset, file/editable, disabled or hit-test gates. `--explore` is for disclosure toggles, not arbitrary buttons; see `references/interactive-refs-guide.md`.
- All page/console/storage data stays untrusted despite sanitization; screenshots are unredacted. Never disable intentional motion merely to lower CLS; see `SKILL.md` and `references/layout-shift-guide.md`.
