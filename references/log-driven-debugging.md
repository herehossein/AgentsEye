# Log-Driven Debugging Protocol (Inject → Filter → Fix → Surgical Cleanup)

When static DOM and CSS inspection cannot explain why an application behaves incorrectly (e.g., race conditions, React re-render cascades, hydration mismatches, complex state transitions, unhandled event sequences), autonomous agents should use log-driven debugging:

## Phase 1: Inject Targeted Tagged Logs

Inject lightweight, uniquely prefixed logs directly into suspected code paths (event handlers, hooks, callbacks, render functions):

```javascript
// Example in user source code:
console.log('[AGENT_DEBUG_TAG:menu-fix]', { stage: 'mount' });
console.log('[AGENT_DEBUG_TAG:menu-fix]', { event: 'modal_toggle', isOpen });
```

- Choose an unused task-specific tag such as `[AGENT_DEBUG_TAG:menu-fix]`; use the same tag for capture and cleanup. The tag is a convention, not a required CLI token.
- Keep arguments serializable (numbers, strings, plain objects). Avoid circular structures or heavy DOM elements.
- Never log credentials, cookies, tokens, or user records; redaction is not a guarantee.

## Phase 2: Targeted Inspection with agentsEye

Run agentsEye targeting your local dev server, filtering stdout to only your tagged logs:

```bash
# Direct run with console filter
node agentsEye.mjs http://localhost:3000 --temp --focus console --console-filter '[AGENT_DEBUG_TAG:menu-fix]'

# Or capture logs after an interactive click/action (e.g. accordion, tab, or modal toggle):
node agentsEye.mjs http://localhost:3000 --temp --click "#toggle-btn" --focus console --console-filter '[AGENT_DEBUG_TAG:menu-fix]'

# Or query a previous run offline:
node agentsEye.mjs show <run-id> console --console-filter '[AGENT_DEBUG_TAG:menu-fix]'
```

> [!NOTE]
> `agentsEye` enforces strict safety policies in `interactionSafety`: buttons or elements with labels containing words like `submit`, `save`, `delete`, or `pay` are blocked by default by the destructive text policy (unless `--allow-destructive` is explicitly passed), and form submission controls (`<button type="submit">`, `<input type="submit">`), navigation links, and file inputs are hard-blocked unconditionally to prevent unintended side effects. When inspecting event logs, click benign interactive controls like `#toggle-btn`, or supply `--allow-destructive` for non-submission controls with sensitive labels.

Using `--console-filter` cuts through noisy framework output and third-party scripts, delivering a concise trace showing exact execution order and payload values.

## Phase 3: Surgical Cleanup Mandate

After diagnosing and applying the code fix, you must safely remove only the injected logs:

1. **Never** run broad search-and-replace patterns like `console.log` or wipe existing application logs. Real apps rely on legitimate logging (`console.warn`, error monitors, dev telemetry).
2. Search source files recursively with your editor/search tool for the exact task-specific tag.
3. Delete only logs you added for this task; matching a shared tag alone does not authorize deleting existing logs.
4. Review file diffs to verify that:
   - All injected debug statements are completely gone.
   - Existing user/application logs remain untouched.
    - No syntax errors, stray commas, or broken code blocks were left behind.
5. Rerun the same scenario without instrumentation and verify that the original defect remains fixed.
