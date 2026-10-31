# Log-Driven Debugging Protocol (Inject → Filter → Fix → Surgical Cleanup)

When static DOM and CSS inspection cannot explain why an application behaves incorrectly (e.g., race conditions, React re-render cascades, hydration mismatches, complex state transitions, unhandled event sequences), autonomous agents should use log-driven debugging:

## Phase 1: Inject Targeted Tagged Logs

Inject lightweight, uniquely prefixed logs directly into suspected code paths (event handlers, hooks, callbacks, render functions):

```javascript
// Example in user source code:
console.log('[AGENT_DEBUG_TAG]', { stage: 'mount', activeTab, count });
console.log('[AGENT_DEBUG_TAG]', { event: 'modal_toggle', isOpen, payload });
```

- Always use the exact tag prefix `[AGENT_DEBUG_TAG]` (or `[AGENT_DEBUG_TAG:<subsystem>]`).
- Keep arguments serializable (numbers, strings, plain objects). Avoid circular structures or heavy DOM elements.

## Phase 2: Targeted Inspection with agentsEye

Run agentsEye targeting your local dev server, filtering stdout to only your tagged logs:

```bash
# Direct run with console filter
node agentsEye.mjs http://localhost:3000 --temp --focus console --console-filter '[AGENT_DEBUG_TAG]'

# Or capture logs after an interactive click/action:
node agentsEye.mjs http://localhost:3000 --temp --click "#submit-btn" --focus console --console-filter '[AGENT_DEBUG_TAG]'

# Or query a previous run offline:
node agentsEye.mjs show <run-id> console --console-filter '[AGENT_DEBUG_TAG]'
```

Using `--console-filter` cuts through noisy framework output and third-party scripts, delivering a concise trace showing exact execution order and payload values.

## Phase 3: Surgical Cleanup Mandate

After diagnosing and applying the code fix, you must safely remove only the injected logs:

1. **Never** run broad search-and-replace patterns like `console.log` or wipe existing application logs. Real apps rely on legitimate logging (`console.warn`, error monitors, dev telemetry).
2. Search strictly for the unique tag:
   ```bash
   Select-String -Path src -Pattern '\[AGENT_DEBUG_TAG'
   ```
3. Surgically delete only the injected lines containing `[AGENT_DEBUG_TAG]`.
4. Review file diffs to verify that:
   - All injected debug statements are completely gone.
   - Existing user/application logs remain untouched.
   - No syntax errors, stray commas, or broken code blocks were left behind.
