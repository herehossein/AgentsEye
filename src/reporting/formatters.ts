import { TOOL_NAME, TOOL_VERSION } from '../config/constants.js';
import { safeJsonStringify } from '../utils/helpers.js';

export function formatDiffText(report: any): string {
  const lines: string[] = [];
  const push = (line = '') => lines.push(line);
  push(`${TOOL_NAME} diff: ${report.before || 'before'} -> ${report.after || 'after'}`);
  const s = report.summary || {};
  push(
    `Summary: +${s.added ?? 0} added, -${s.removed ?? 0} removed, ${s.layoutChanged ?? 0} layout changed, ${s.styleChanged ?? 0} styles changed, ${s.newErrors ?? 0} new errors, ${s.newIssues ?? 0} new issues`,
  );
  if (report.newIssues?.length) {
    push('New Issues:');
    for (const issue of report.newIssues)
      push(`  [${issue.severity || 'issue'}] ${issue.code}: ${issue.message}`);
  }
  if (report.newErrors?.length) {
    push('New Errors:');
    for (const err of report.newErrors)
      push(`  ${err.text || err.message || safeJsonStringify(err)}`);
  }
  if (report.added?.length) {
    push('Added elements:');
    for (const el of report.added.slice(0, 20))
      push(`  + ${el.tag || 'node'}${el.id ? ` #${el.id}` : ''}`);
    if (report.added.length > 20) push(`  … ${report.added.length - 20} more`);
  }
  if (report.removed?.length) {
    push('Removed elements:');
    for (const el of report.removed.slice(0, 20))
      push(`  - ${el.tag || 'node'}${el.id ? ` #${el.id}` : ''}`);
    if (report.removed.length > 20) push(`  … ${report.removed.length - 20} more`);
  }
  if (report.layout?.length) {
    push('Layout changes:');
    for (const l of report.layout.slice(0, 20))
      push(`  ~ ${l.tag || 'node'}${l.id ? ` #${l.id}` : ''}`);
    if (report.layout.length > 20) push(`  … ${report.layout.length - 20} more`);
  }
  if (report.styles?.length) {
    push('Style changes:');
    for (const st of report.styles.slice(0, 20))
      push(`  ~ ${st.tag || 'node'}${st.id ? ` #${st.id}` : ''}`);
    if (report.styles.length > 20) push(`  … ${report.styles.length - 20} more`);
  }
  if (report.note) push(`Note: ${report.note}`);
  return `${lines.join('\n')}\n`;
}

export function formatQueryValue(val: unknown, indent = '  ', ancestors: unknown[] = []): string {
  if (val === null || val === undefined) return `${indent}(empty / null)`;
  if (typeof val === 'bigint') return `${indent}${val.toString()}`;
  if (typeof val !== 'object') return `${indent}${val}`;
  if (ancestors.includes(val)) return `${indent}[Circular]`;
  const nextAncestors = [...ancestors, val];
  if (Array.isArray(val)) {
    if (!val.length) return `${indent}[]`;
    return val
      .map((item, i) => {
        if (item === null || typeof item !== 'object')
          return `${indent}- ${typeof item === 'bigint' ? item.toString() : item}`;
        return `${indent}[${i}]:\n${formatQueryValue(item, indent + '  ', nextAncestors)}`;
      })
      .join('\n');
  }
  const entries = Object.entries(val as Record<string, unknown>);
  if (!entries.length) return `${indent}{}`;
  return entries
    .map(([k, v]) => {
      if (v === null || typeof v !== 'object')
        return `${indent}${k}: ${typeof v === 'bigint' ? v.toString() : v}`;
      return `${indent}${k}:\n${formatQueryValue(v, indent + '  ', nextAncestors)}`;
    })
    .join('\n');
}

export function formatQueryText(report: any): string {
  const lines: string[] = [];
  const push = (line = '') => lines.push(line);
  push(`Query: ${report.query}`);
  if (report.run?.id) push(`Run: ${report.run.id}`);
  push('Result:');
  push(formatQueryValue(report.data));
  return `${lines.join('\n')}\n`;
}

export function formatSummaryText(report: any): string {
  const lines: string[] = [];
  const push = (line = '') => lines.push(line);
  const target = report.target || {};
  const run = report.run || {};
  const vp = report.viewport || {};
  const perf = report.performance || {};
  const layout = report.layout || {};

  push(`${TOOL_NAME} v${TOOL_VERSION}`);
  if (report.security?.promptInjectionDetected) {
    push(
      `[SECURITY ALERT] Prompt Injection DETECTED (${report.security.threatLevel.toUpperCase()}). Malicious instructions neutralized.`,
    );
  }
  push(
    `Target: ${target.finalUrl || target.requestedUrl || '(unknown)'}${
      target.httpStatus != null ? ` [HTTP ${target.httpStatus}]` : ''
    }`,
  );
  if (target.title) push(`Title: ${target.title}`);
  if (run.id) push(`Run: ${run.id} (${run.directory || ''})`);
  if (vp.width) push(`Viewport: ${vp.width}x${vp.height} @${vp.dpr}x${vp.mobile ? ' mobile' : ''}`);
  if (report.durationMs != null) push(`Duration: ${report.durationMs}ms`);

  const vitals = perf.webVitals || perf;
  if (vitals && typeof vitals === 'object') {
    const parts: string[] = [];
    if (vitals.lcp != null) parts.push(`LCP=${vitals.lcp}ms`);
    if (vitals.cls != null) parts.push(`CLS=${vitals.cls}`);
    if (vitals.inp != null) parts.push(`INP=${vitals.inp}ms`);
    if (vitals.fcp != null) parts.push(`FCP=${vitals.fcp}ms`);
    if (vitals.ttfb != null) parts.push(`TTFB=${vitals.ttfb}ms`);
    if (parts.length) push(`Web Vitals: ${parts.join(' ')}`);
  }

  const issueCountList = Object.entries(layout.issueCounts || {})
    .filter(([, c]) => (c as number) > 0)
    .map(([code, c]) => `${code}=${c}`)
    .join(', ');
  push(
    `Layout: overflow=${layout.horizontalOverflow ? 'YES' : 'no'} scrollTrap=${
      layout.scrollTrap ? 'YES' : 'no'
    } nodes=${layout.nodes ?? '?'}${issueCountList ? ` (${issueCountList})` : ''}`,
  );

  if (report.issues?.length) {
    push('Issues:');
    for (const issue of report.issues) {
      push(`  [${issue.severity || 'info'}] ${issue.code}: ${issue.message}`);
    }
  } else {
    push('Issues: none detected');
  }

  if (report.errors) {
    push(
      `Errors: uncaught=${report.errors.uncaughtCount ?? 0} logErrors=${report.errors.logErrorCount ?? 0}`,
    );
    for (const err of report.errors.uncaught || []) {
      push(`  uncaught: ${err.text || err.message || safeJsonStringify(err)}`);
    }
  }

  if (report.console) {
    const counts = Object.entries(report.console.counts || {})
      .filter(([, c]) => (c as number) > 0)
      .map(([k, c]) => `${k}=${c}`)
      .join(' ');
    if (counts) push(`Console counts: ${counts}`);
  }

  if (report.network) {
    push(`Network: total=${report.network.total ?? 0} failed=${report.network.failed ?? 0}`);
  }

  if (report.landmarks) {
    const counts = Object.entries(report.landmarks)
      .filter(([, v]) => (v as any)?.count)
      .map(([k, v]) => `${k}=${(v as any).count}`)
      .join(' ');
    if (counts) push(`Landmarks: ${counts}`);
  }

  if (report.headings?.outline?.length || report.headings?.items?.length) {
    push('Headings:');
    const outline =
      report.headings.outline ||
      report.headings.items.map((h: any) => `h${h.level}: ${h.text || '(empty)'}`);
    for (const h of outline.slice(0, 30)) {
      push(`  ${h}`);
    }
  }

  if (report.interactions) {
    const inter = report.interactions;
    push(`Interactions: performed=${inter.performed ?? 0} explored=${inter.explored ?? 0}`);
    if (inter.diff) {
      const d = inter.diff;
      push(
        `  Diff: +${d.added ?? 0} added, -${d.removed ?? 0} removed, ${d.layoutChanged ?? 0} layout changed, ${
          d.stateChanged ?? 0
        } state changed`,
      );
    }
  }

  if (report.matrix) {
    push(`Matrix: ${report.matrix.viewports?.length ?? 0} viewports analyzed`);
  }

  if (report.warnings?.length) {
    push('Warnings:');
    for (const w of report.warnings) push(`  - ${w}`);
  }

  return `${lines.join('\n')}\n`;
}

export function formatFocusSliceText(report: any): string {
  const lines: string[] = [];
  const push = (line = '') => lines.push(line);
  const target = report.target || {};
  const run = report.run || {};
  push(`${TOOL_NAME} v${TOOL_VERSION} (Focus View)`);
  if (report.security?.promptInjectionDetected) {
    push(
      `[SECURITY ALERT] Prompt Injection DETECTED (${report.security.threatLevel.toUpperCase()}). Malicious instructions neutralized.`,
    );
  }
  push(`Target: ${target.finalUrl || target.requestedUrl || '(unknown)'}`);
  if (run.id) push(`Run: ${run.id}`);

  if (report.issues !== undefined) {
    push('Issues:');
    for (const issue of report.issues || []) {
      push(`  [${issue.severity || 'info'}] ${issue.code}: ${issue.message}`);
    }
    if (report.shifts != null) push(`Cumulative Layout Shift (CLS): ${report.shifts}`);
    if (report.layout)
      push(
        `Layout: overflow=${report.layout.horizontalOverflow ? 'yes' : 'no'} scrollWidth=${
          report.layout.documentScrollWidth ?? '?'
        }`,
      );
    if (report.scrollLock)
      push(`ScrollLock: trapRisk=${report.scrollLock.trapRisk ? 'yes' : 'no'}`);
    if (report.console?.entries?.length) {
      push('Console Errors:');
      for (const entry of report.console.entries)
        push(`  ${entry.type}: ${safeJsonStringify(entry.args)}`);
    }
  } else if (report.forms !== undefined) {
    const forms = report.forms || {};
    push(`Forms: count=${forms.items?.length ?? forms.count ?? 0}`);
    if (forms.items?.length) {
      for (const form of forms.items) {
        push(
          `  Form: action="${form.action || ''}" method="${form.method || 'get'}" inputs=${form.inputs?.length ?? 0}`,
        );
        for (const input of (form.inputs || []).slice(0, 10)) {
          push(
            `    Input: type="${input.type || 'text'}" name="${input.name || ''}" required=${input.required ? 'yes' : 'no'}`,
          );
        }
      }
    }
    if (forms.controls?.length) {
      push(`Controls (${forms.controls.length}):`);
      for (const ctrl of forms.controls.slice(0, 15)) {
        push(`  [${ctrl.tag || 'input'}] name="${ctrl.name || ''}" type="${ctrl.type || ''}"`);
      }
    }
  } else if (report.dom !== undefined) {
    const dom = report.dom || {};
    const stats = dom.stats || {};
    push(
      `DOM Stats: ${stats.elementNodes ?? 0} elements, maxDepth ${stats.maxDepthReached ?? 0}, shadowRoots ${
        stats.shadowRoots ?? 0
      }, iframes ${stats.iframes ?? 0}`,
    );
    if (dom.trees) {
      push('DOM Outline:');
      const walk = (node: any, depth = 0) => {
        if (!node || depth > 4) return;
        const tag = node.tag || node.type || 'node';
        const id = node.id ? `#${node.id}` : '';
        push(`${'  '.repeat(depth)}${tag}${id}`);
        for (const child of (node.children || []).slice(0, 8)) walk(child, depth + 1);
      };
      if (Array.isArray(dom.trees)) dom.trees.forEach((t: any) => walk(t, 1));
      else walk(dom.trees, 1);
    }
  } else if (report.network !== undefined) {
    const net = report.network || {};
    const s = net.summary || {};
    push(`Network: total=${s.total ?? 0} failed=${s.failed ?? 0}`);
    if (net.failures?.length) {
      push('Failures:');
      for (const f of net.failures)
        push(`  failed: ${f.method || '?'} ${f.url} ${f.errorText || ''}`);
    }
  } else if (report.performance !== undefined) {
    const perf = report.performance || {};
    const vitals = perf.page?.webVitals || perf.vitals || {};
    push('Performance & Web Vitals:');
    if (vitals.lcp != null) push(`  LCP: ${vitals.lcp}ms`);
    if (vitals.cls != null) push(`  CLS: ${vitals.cls}`);
    if (vitals.inp != null) push(`  INP: ${vitals.inp}ms`);
    if (vitals.fcp != null) push(`  FCP: ${vitals.fcp}ms`);
    if (vitals.ttfb != null) push(`  TTFB: ${vitals.ttfb}ms`);
    if (perf.page?.navigation?.duration != null)
      push(`  Navigation duration: ${perf.page.navigation.duration}ms`);
  } else if (report.console !== undefined && report.issues === undefined) {
    const c = report.console || {};
    push(
      `Console entries: ${c.matched ?? c.entries?.length ?? 0} (total: ${c.total ?? c.entries?.length ?? 0})`,
    );
    if (c.level) push(`  Level: ${Array.isArray(c.level) ? c.level.join(',') : c.level}`);
    if (c.filter) push(`  Filter: "${c.filter}"`);
    const counts = Object.entries(c.counts || {})
      .filter(([, v]) => (v as number) > 0)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    if (counts) push(`  Counts: ${counts}`);
    if (c.entries?.length) {
      push('Entries:');
      for (const entry of c.entries.slice(0, 50)) {
        const argsStr = (entry.args || [])
          .map((a: any) => (typeof a === 'string' ? a : safeJsonStringify(a)))
          .join(' ');
        push(`  [${entry.type || 'log'}] ${argsStr || entry.text || ''}`);
      }
    } else {
      push('  (no matching console entries)');
    }
  }
  return `${lines.join('\n')}\n`;
}

export function formatText(report: any, options: any = {}): string {
  if (!report || typeof report !== 'object') return `${String(report)}\n`;
  if (report.ok === false && report.error) {
    return `${TOOL_NAME} v${TOOL_VERSION} ERROR: [${report.error.code || 'ERROR'}] ${report.error.message || ''}\n`;
  }
  if (report.before && report.after && report.summary) return formatDiffText(report);
  if (report.query && 'data' in report) return formatQueryText(report);
  if (report.layout?.issueCounts !== undefined) return formatSummaryText(report);
  if (
    (report.issues !== undefined && report.shifts !== undefined && !report.page) ||
    (report.forms !== undefined && !report.page) ||
    (report.dom !== undefined && !report.page && !report.layout) ||
    (report.network !== undefined && !report.page && !report.layout) ||
    (report.performance !== undefined && !report.page && !report.layout) ||
    (report.console !== undefined && report.issues === undefined && !report.page && !report.layout)
  ) {
    return formatFocusSliceText(report);
  }

  const lines: string[] = [];
  const push = (line = '') => lines.push(line);
  const target = report.target || {};
  const page = report.page || {};
  const metrics = page.metrics || {};
  const dom = report.dom || {};
  const stats = dom.stats || {};
  const env = report.environment || {};

  push(`${TOOL_NAME} v${TOOL_VERSION}`);
  push(`Target: ${target.finalUrl || target.requestedUrl || options?.url || '(unknown)'}`);
  if (target.httpStatus != null) push(`HTTP status: ${target.httpStatus}`);
  push(`Title: ${target.title ?? page.title ?? '(none)'}`);
  if (env.browser) push(`Browser: ${env.browser}`);
  if (env.viewport) {
    push(
      `Viewport: ${env.viewport.width}x${env.viewport.height} @${env.viewport.dpr}x` +
        `${env.viewport.mobile ? ' mobile' : ''}${env.touch ? ' touch' : ''}`,
    );
  }
  push(
    `Page: readyState=${page.readyState ?? '?'} scroll=(${metrics.scrollX ?? '?'},${metrics.scrollY ?? '?'}) ` +
      `scrollSize=${metrics.documentScrollWidth ?? '?'}x${metrics.documentScrollHeight ?? '?'} ` +
      `horizontalOverflow=${metrics.horizontalOverflow ? 'yes' : 'no'}`,
  );
  if (metrics.visualViewport) {
    const vv = metrics.visualViewport;
    push(
      `Visual viewport: ${Math.round(vv.width)}x${Math.round(vv.height)} ` +
        `offset=(${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}) scale=${vv.scale}`,
    );
  }
  if (page.media) {
    push(
      `Media: dark=${page.media.prefersColorSchemeDark ? 'yes' : 'no'} ` +
        `reducedMotion=${page.media.prefersReducedMotion ? 'yes' : 'no'} ` +
        `portrait=${page.media.portrait ? 'yes' : 'no'}`,
    );
  }
  if (dom.trees) {
    push(
      `DOM: ${stats.elementNodes ?? 0} elements (visible ${stats.visibleElements ?? 0}, ` +
        `hidden ${stats.hiddenElements ?? 0}), depth ${stats.maxDepthReached ?? 0}, ` +
        `shadowRoots ${stats.shadowRoots ?? 0}, iframes ${stats.iframes ?? 0}` +
        `${stats.truncated || dom.truncated ? ', TRUNCATED' : ''}`,
    );
  }
  if (report.landmarks) {
    const counts = Object.entries(report.landmarks)
      .filter(([, value]: any) => value && value.count)
      .map(([name, value]: any) => `${name}=${value.count}`);
    if (counts.length) push(`Landmarks: ${counts.join(' ')}`);
  }
  if (report.headings?.items?.length) {
    push('Headings:');
    for (const heading of report.headings.items.slice(0, 30)) {
      push(
        `  h${heading.level} ${heading.text || '(empty)'}${heading.id ? ` #${heading.id}` : ''}`,
      );
    }
    if (report.headings.truncated) push('  … truncated');
  }
  if (report.issues?.length) {
    push('Issues:');
    for (const issue of report.issues.slice(0, 40)) {
      push(`  [${issue.severity || 'info'}] ${issue.code}: ${issue.message}`);
    }
    if (report.issues.length > 40) push(`  … ${report.issues.length - 40} more`);
  }
  if (report.console) {
    const counts = report.console.counts || {};
    const summary = Object.entries(counts)
      .filter(([, count]) => count)
      .map(([type, count]) => `${type}=${count}`)
      .join(' ');
    if (summary) push(`Console: ${summary}`);
    for (const entry of (report.console.entries || []).slice(0, 15)) {
      if (entry.type === 'error' || entry.type === 'warning' || entry.type === 'warn') {
        push(`  ${entry.type}: ${safeJsonStringify(entry.args)}`);
      }
    }
  }
  if (report.errors?.uncaught?.length) {
    push(`Uncaught exceptions: ${report.errors.uncaught.length}`);
    for (const error of report.errors.uncaught.slice(0, 10)) {
      push(`  ${error.text || error.message || '(unknown)'}`);
    }
  }
  if (report.network) {
    const summary = report.network.summary || {};
    push(
      `Network: ${summary.total ?? 0} requests, ${summary.failed ?? 0} failed, ` +
        `${summary.statusClasses ? JSON.stringify(summary.statusClasses) : ''}`,
    );
    for (const request of (report.network.failures || []).slice(0, 10)) {
      push(`  failed: ${request.method || '?'} ${request.url} ${request.errorText || ''}`);
    }
  }
  if (report.storage) {
    const local = report.storage.localStorage || {};
    const session = report.storage.sessionStorage || {};
    push(
      `Storage: localStorage ${local.count ?? 0} keys, sessionStorage ${session.count ?? 0} keys`,
    );
  }
  if (report.cookies) {
    push(`Cookies: ${report.cookies.count ?? 0}`);
  }
  if (report.screenshots?.length) {
    for (const shot of report.screenshots) {
      const role = shot.role ? `[${shot.role}] ` : '';
      push(
        `Screenshot: ${role}${shot.path} (${shot.bytes} bytes${shot.width ? `, ${shot.width}x${shot.height}` : ''})`,
      );
    }
  }

  const tree = dom.trees;
  if (tree && !Array.isArray(tree)) {
    push('DOM outline:');
    let emitted = 0;
    const maxOutline = 300;
    const walkText = (node: any, depth: number) => {
      if (!node || emitted >= maxOutline) return;
      if (node.type === 'text') {
        push(`${'  '.repeat(depth)}"${node.text}"`);
        emitted += 1;
        return;
      }
      const flags = [
        node.rendered === false ? 'hidden' : null,
        node.inViewport ? 'inViewport' : null,
        node.interactive ? 'interactive' : null,
        node.scroll ? 'scrollable' : null,
      ].filter(Boolean);
      const rect = node.rect?.viewport;
      const size = rect ? ` ${Math.round(rect.width)}x${Math.round(rect.height)}` : '';
      push(
        `${'  '.repeat(depth)}${node.selector || node.tag}${size}` +
          `${flags.length ? ` [${flags.join(',')}]` : ''}` +
          `${node.ownText ? ` “${node.ownText}”` : ''}`,
      );
      emitted += 1;
      for (const child of node.children || []) walkText(child, depth + 1);
      if (node.shadowRoot) {
        push(`${'  '.repeat(depth + 1)}#shadow-root`);
        for (const child of node.shadowRoot.children || []) walkText(child, depth + 2);
      }
      if (node.frameContent) {
        push(`${'  '.repeat(depth + 1)}#iframe-content`);
        walkText(node.frameContent, depth + 2);
      }
    };
    walkText(tree, 0);
    if (emitted >= maxOutline) push('  … outline truncated');
  }

  if (report.warnings?.length) {
    push('Warnings:');
    for (const warning of report.warnings.slice(0, 30)) push(`  - ${warning}`);
  }
  if (report.meta?.truncation) {
    push(`Truncation: ${JSON.stringify(report.meta.truncation)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function serializeOutput(report: any, options: any = {}): string {
  const opts = options || {};
  if (opts.format === 'text') {
    return formatText(report, opts);
  }
  return `${safeJsonStringify(report, opts.pretty ? 2 : 0)}\n`;
}
