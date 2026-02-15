import { loadConfig } from "../config/load.js";
import { TriggerConnector } from "../connectors/trigger.js";
import { LocalConnector } from "../connectors/local.js";
import { DatadogConnector } from "../connectors/datadog.js";
import { correlateEvents } from "../core/correlator.js";
import { explainIncident } from "../llm/explain.js";
import type { NormalizedEvent } from "../core/types.js";

const DEFAULT_WINDOW_MINUTES = 15;

interface InvestigationOptions {
  windowMinutes?: number;
  query?: string;
}

function formatEvent(event: NormalizedEvent): string {
  return `${event.timestamp.toISOString()} ${event.source} ${event.type}`;
}

export async function runInvestigation(options: InvestigationOptions = {}): Promise<void> {
  const config = await loadConfig();
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
  const connectors = [
    new TriggerConnector(config),
    new LocalConnector(config),
    new DatadogConnector(config)
  ];

  console.log(`🐸 Scanning last ${windowMinutes} minutes...`);

  const events = await Promise.all(connectors.map((connector) => connector.fetchEvents(windowStart)));
  const flattened = events.flat();

  const report = correlateEvents(flattened);

  if (!report) {
    console.log("🐸 No significant failure patterns detected.");
    return;
  }

  const explanation = await explainIncident({
    pattern: report.match.patternId,
    timeline: report.timeline,
    evidence: report.match.evidence,
    confidence: report.match.confidence,
    rootCauseEvent: report.match.rootCauseEvent,
    query: options.query
  });

  console.log("Incident detected.");
  console.log("Trigger:");
  console.log(`- ${report.match.rootCauseEvent.type}`);
  console.log("Cascade:");
  report.match.evidence
    .slice(1)
    .forEach((event: NormalizedEvent) => console.log(`→ ${formatEvent(event)}`));
  console.log("Root Cause:");
  console.log(`- ${explanation.explanation}`);
  console.log(`Confidence: ${report.match.confidence.toFixed(2)}`);
  console.log(`Suggested Fix: ${explanation.suggestion}`);
}
