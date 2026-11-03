import { SCHEMA_VERSION } from '../config/constants.js';

export function diffReports(before: any, after: any): any {
  const flatten = (report: any) => {
    const nodes = new Map<string, any>();
    const walk = (node: any, parent = 'root', ordinal = 0) => {
      if (!node || !node.tag) return;
      const key = node.id ? `${parent.split('::')[0]}::#${node.id}` : `${parent}/${node.tag}[${ordinal}]`;
      nodes.set(key, node);
      const counts: Record<string, number> = {};
      for (const child of node.children ?? []) {
        const tag = child.tag ?? child.type;
        const index = counts[tag] ?? 0;
        counts[tag] = index + 1;
        walk(child, key, index);
      }
      for (const [index, child] of (node.shadowRoot?.children ?? []).entries()) walk(child, `${key}::shadow`, index);
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
    if (a && b && ['left', 'top', 'width', 'height'].some((prop) => Math.abs(a[prop] - b[prop]) > 1)) {
      layoutCount += 1;
      if (layout.length < 50) layout.push({ key, selector: node.selector, before: a, after: b });
    }
    const changed: Record<string, any> = {};
    for (const prop of new Set([...Object.keys(previous.styles ?? {}), ...Object.keys(node.styles ?? {})])) {
      if (previous.styles?.[prop] !== node.styles?.[prop]) {
        changed[prop] = { before: previous.styles?.[prop] ?? null, after: node.styles?.[prop] ?? null };
      }
    }
    if (Object.keys(changed).length || previous.rendered !== node.rendered) {
      styleCount += 1;
      if (styles.length < 50) {
        styles.push({ key, selector: node.selector, changes: changed, rendered: { before: previous.rendered, after: node.rendered } });
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
    ...(report.console?.entries ?? []).filter((entry: any) => ['error', 'assert'].includes(entry.type)),
  ];
  const errorKey = (entry: any) => JSON.stringify([entry.text ?? entry.message ?? entry.args, entry.url, entry.lineNumber]);
  const previousErrors = new Set(diagnostics(before).map(errorKey));
  const newErrors = diagnostics(after).filter((entry: any) => !previousErrors.has(errorKey(entry)));
  const issueKey = (issue: any) => `${issue.code}:${issue.cssPath ?? ''}`;
  const previousIssues = new Set((before.issues ?? []).map(issueKey));
  const newIssues = (after.issues ?? []).filter((issue: any) => !previousIssues.has(issueKey(issue)));
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
    truncated: [addedCount, removedCount, layoutCount, styleCount, newErrors.length, newIssues.length].some((count) => count > 50),
    note: 'Heuristic structural matching; bounding-box/style differences require review, not every change is a regression.',
  };
}
