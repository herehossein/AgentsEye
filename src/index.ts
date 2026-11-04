import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULTS,
  DEFAULT_SUMMARY_INTERACTIVE_LIMIT,
  FOCUS_SLICES,
  MATRIX_VIEWPORTS,
  REF_ATTR,
  REF_PREFIX,
  REF_REGEX,
  REF_REGISTRY_SLOT,
  SCHEMA_VERSION,
  TAILWIND_VIEWPORTS,
  TOOL_NAME,
  TOOL_VERSION,
} from './config/constants.js';

import { parseArgs, parseViewport } from './cli/parser.js';

import {
  compactDom,
  focusReport,
  minimalSummary,
  outputView,
  queryReport,
  selectSections,
} from './reporting/views.js';

import { formatText, serializeOutput } from './reporting/formatters.js';

import { diffReports } from './reporting/diff.js';

import { redactReport, redactString, redactUrl } from './security/redaction.js';

import {
  auditAndSanitizeReport,
  neutralizeControlTokens,
  sanitizePromptInjection,
  scanPromptInjection,
} from './security/prompt-injection.js';

import {
  isMetadataHost,
  isPrivateHost,
  validateBrowserArg,
  validateCdpEndpoint,
  validateResolvedHostname,
  validateResolvedTargetUrl,
  validateTargetUrl,
} from './security/url-guard.js';

import { resolveSafePath, validateRunId } from './security/path-guard.js';

import { cleanRuns, createRun, persistRun, readRun } from './storage/runs.js';

import { evaluate, connectCdp } from './cdp/client.js';

import { attachToCdp, findBrowser, launchBrowser } from './cdp/browser.js';

import {
  attachCaptureHandlers,
  installRequestGuard,
  preparePage,
  waitForNetworkIdle,
} from './cdp/capture.js';

import { collectPerformance, installPerformanceObservers } from './cdp/collectors.js';

import { inPageProbe, makeProbeConfig } from './probes/dom-probe.js';

import { inPageInteractionProbe, interactionSafety } from './probes/interaction-probe.js';

import { inPagePerformanceObserver } from './probes/perf-observer-probe.js';

import { diffInteractionSnapshots, performInteractions } from './interactions/runner.js';

import { inspectPage } from './inspector/inspect-page.js';

import { main } from './inspector/main.js';

export {
  parseArgs,
  parseViewport,
  selectSections,
  redactReport,
  redactString,
  redactUrl,
  makeProbeConfig,
  inPageProbe,
  evaluate,
  findBrowser,
  minimalSummary,
  compactDom,
  focusReport,
  queryReport,
  diffReports,
  readRun,
  createRun,
  persistRun,
  cleanRuns,
  validateRunId,
  validateResolvedTargetUrl,
  validateResolvedHostname,
  attachToCdp,
  attachCaptureHandlers,
  preparePage,
  waitForNetworkIdle,
  isMetadataHost,
  isPrivateHost,
  validateTargetUrl,
  validateCdpEndpoint,
  connectCdp,
  launchBrowser,
  installRequestGuard,
  inspectPage,
  performInteractions,
  installPerformanceObservers,
  collectPerformance,
  interactionSafety,
  inPageInteractionProbe,
  diffInteractionSnapshots,
  inPagePerformanceObserver,
  formatText,
  serializeOutput,
  outputView,
  validateBrowserArg,
  resolveSafePath,
  neutralizeControlTokens,
  scanPromptInjection,
  sanitizePromptInjection,
  auditAndSanitizeReport,
  TAILWIND_VIEWPORTS,
  MATRIX_VIEWPORTS,
  DEFAULTS,
  TOOL_NAME,
  TOOL_VERSION,
  SCHEMA_VERSION,
  REF_PREFIX,
  REF_REGEX,
  REF_ATTR,
  REF_REGISTRY_SLOT,
  DEFAULT_SUMMARY_INTERACTIVE_LIMIT,
  FOCUS_SLICES,
  main,
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: any) => {
    process.stderr.write(`${TOOL_NAME}: fatal: ${redactString(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
