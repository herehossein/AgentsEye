import { SCHEMA_VERSION } from '../config/constants.js';
import { InteractiveDelta, DeltaOperation } from '../types/report.js';

export function diffReports(before: any, after: any): any {
  const flatten = (report: any) => {
    const nodes = new Map<string, any>();
    const walk = (node: any, parent = 'root', ordinal = 0) => {
      if (!node || !node.tag) return;
      const key = node.id
        ? `${parent.split('::')[0]}::#${node.id}`
        : `${parent}/${node.tag}[${ordinal}]`;
      nodes.set(key, node);
      const counts: Record<string, number> = {};
      for (const child of node.children ?? []) {
        const tag = child.tag ?? child.type;
        const index = counts[tag] ?? 0;
        counts[tag] = index + 1;
        walk(child, key, index);
      }
      for (const [index, child] of (node.shadowRoot?.children ?? []).entries())
        walk(child, `${key}::shadow`, index);
      if (node.frameContent) walk(node.frameContent, `${key}::frame`, 0);
    };
    const trees = report.dom?.trees ?? report.dom?.tree;
    (Array.isArray(trees) ? trees : [trees]).forEach((tree, index) => walk(tree, `root${index}`));
    return nodes;
  };
  const left = flatten(before);
  const right = flatten(after);
  const added: any[] = [];
  const removed: any[] = [];
  const layout: any[] = [];
  const styles: any[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let layoutCount = 0;
  let styleCount = 0;
  for (const [key, node] of right) {
    if (!left.has(key)) {
      addedCount += 1;
      if (added.length < 50) added.push({ key, selector: node.selector });
      continue;
    }
    const previous = left.get(key);
    const a = previous.rect?.viewport;
    const b = node.rect?.viewport;
    if (
      a &&
      b &&
      ['left', 'top', 'width', 'height'].some((prop) => Math.abs(a[prop] - b[prop]) > 1)
    ) {
      layoutCount += 1;
      if (layout.length < 50) layout.push({ key, selector: node.selector, before: a, after: b });
    }
    const changed: Record<string, any> = {};
    for (const prop of new Set([
      ...Object.keys(previous.styles ?? {}),
      ...Object.keys(node.styles ?? {}),
    ])) {
      if (previous.styles?.[prop] !== node.styles?.[prop]) {
        changed[prop] = {
          before: previous.styles?.[prop] ?? null,
          after: node.styles?.[prop] ?? null,
        };
      }
    }
    if (Object.keys(changed).length || previous.rendered !== node.rendered) {
      styleCount += 1;
      if (styles.length < 50) {
        styles.push({
          key,
          selector: node.selector,
          changes: changed,
          rendered: { before: previous.rendered, after: node.rendered },
        });
      }
    }
  }
  for (const [key, node] of left) {
    if (!right.has(key)) {
      removedCount += 1;
      if (removed.length < 50) removed.push({ key, selector: node.selector });
    }
  }
  const diagnostics = (report: any) => [
    ...(report.errors?.uncaught ?? []),
    ...(report.errors?.logErrors ?? []),
    ...(report.console?.entries ?? []).filter((entry: any) =>
      ['error', 'assert'].includes(entry.type),
    ),
  ];
  const errorKey = (entry: any) =>
    JSON.stringify([entry.text ?? entry.message ?? entry.args, entry.url, entry.lineNumber]);
  const previousErrors = new Set(diagnostics(before).map(errorKey));
  const newErrors = diagnostics(after).filter((entry: any) => !previousErrors.has(errorKey(entry)));
  const issueKey = (issue: any) => `${issue.code}:${issue.cssPath ?? ''}`;
  const previousIssues = new Set((before.issues ?? []).map(issueKey));
  const newIssues = (after.issues ?? []).filter(
    (issue: any) => !previousIssues.has(issueKey(issue)),
  );
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    before: before.run?.id,
    after: after.run?.id,
    summary: {
      added: addedCount,
      removed: removedCount,
      layoutChanged: layoutCount,
      styleChanged: styleCount,
      newErrors: newErrors.length,
      newIssues: newIssues.length,
    },
    added,
    removed,
    layout,
    styles,
    newErrors: newErrors.slice(0, 50),
    newIssues: newIssues.slice(0, 50),
    truncated: [
      addedCount,
      removedCount,
      layoutCount,
      styleCount,
      newErrors.length,
      newIssues.length,
    ].some((count) => count > 50),
    note: 'Heuristic structural matching; bounding-box/style differences require review, not every change is a regression.',
  };
}

/**
 * Computes unified text line diffs with configurable context radius.
 */
export function computeUnifiedTextDiff(
  beforeText: string,
  afterText: string,
  _contextRadius = 3,
): { diff: string; additions: number; removals: number; unchanged: number; changed: boolean } {
  if (beforeText === afterText) {
    return {
      diff: '',
      additions: 0,
      removals: 0,
      unchanged: beforeText ? beforeText.split('\n').length : 0,
      changed: false,
    };
  }

  const beforeLines = beforeText ? beforeText.split('\n') : [];
  const afterLines = afterText ? afterText.split('\n') : [];

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const bMid = beforeLines.slice(prefix, beforeLines.length - suffix);
  const aMid = afterLines.slice(prefix, afterLines.length - suffix);

  const diffLines: string[] = ['--- before', '+++ after'];
  let additions = 0;
  let removals = 0;
  let unchanged = prefix + suffix;

  const n = bMid.length;
  const m = aMid.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (bMid[i - 1] === aMid[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n;
  let j = m;
  const midDiff: string[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && bMid[i - 1] === aMid[j - 1]) {
      midDiff.push(`  ${bMid[i - 1]}`);
      unchanged++;
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      midDiff.push(`+ ${aMid[j - 1]}`);
      additions++;
      j--;
    } else {
      midDiff.push(`- ${bMid[i - 1]}`);
      removals++;
      i--;
    }
  }
  midDiff.reverse();

  const changed = additions > 0 || removals > 0;
  if (changed) {
    const preContext = beforeLines.slice(Math.max(0, prefix - _contextRadius), prefix);
    for (const line of preContext) diffLines.push(`  ${line}`);
    diffLines.push(...midDiff);
    const postContext = beforeLines.slice(
      beforeLines.length - suffix,
      Math.min(beforeLines.length, beforeLines.length - suffix + _contextRadius),
    );
    for (const line of postContext) diffLines.push(`  ${line}`);
  }

  return {
    diff: changed ? diffLines.join('\n') : '',
    additions,
    removals,
    unchanged,
    changed,
  };
}

/**
 * Computes an ultra-compact interactive delta between consecutive snapshots.
 * Returns kind: 'unchanged' (~10 tokens) when DOM state is identical.
 */
export function diffInteractiveSnapshots(
  beforeItems: any[] = [],
  afterItems: any[] = [],
  beforeTreeText = '',
  afterTreeText = '',
): InteractiveDelta {
  const beforeMap = new Map<string, any>();
  const afterMap = new Map<string, any>();

  for (const item of beforeItems) if (item.ref) beforeMap.set(item.ref, item);
  for (const item of afterItems) if (item.ref) afterMap.set(item.ref, item);

  if (beforeTreeText && afterTreeText && beforeTreeText === afterTreeText) {
    return {
      kind: 'unchanged',
      changed: false,
      additions: 0,
      removals: 0,
      replacements: 0,
      unchanged: afterItems.length,
      diff: '',
    };
  }

  const changes: DeltaOperation[] = [];
  let additions = 0;
  let removals = 0;
  let replacements = 0;

  for (const [ref, item] of beforeMap.entries()) {
    if (!afterMap.has(ref)) {
      changes.push({ op: 'remove', ref, role: item.role, name: item.name });
      removals++;
    }
  }

  for (const [ref, afterItem] of afterMap.entries()) {
    const beforeItem = beforeMap.get(ref);
    if (!beforeItem) {
      changes.push({
        op: 'add',
        ref,
        role: afterItem.role,
        name: afterItem.name,
        tag: afterItem.tag,
      });
      additions++;
    } else if (
      beforeItem.role !== afterItem.role ||
      beforeItem.name !== afterItem.name ||
      beforeItem.disabled !== afterItem.disabled ||
      beforeItem.checked !== afterItem.checked
    ) {
      changes.push({
        op: 'replace',
        ref,
        role: afterItem.role,
        name: afterItem.name,
      });
      replacements++;
    }
  }

  const textDiff = computeUnifiedTextDiff(beforeTreeText, afterTreeText);

  return {
    kind: changes.length === 0 && !textDiff.changed ? 'unchanged' : 'delta',
    changed: changes.length > 0 || textDiff.changed,
    additions,
    removals,
    replacements,
    unchanged: Math.max(0, afterItems.length - additions - replacements),
    changes,
    diff: textDiff.diff,
  };
}
