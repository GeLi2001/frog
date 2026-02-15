import { loadConfig } from "../config/load.js";
import { TriggerConnector } from "../connectors/trigger.js";
import { LocalConnector } from "../connectors/local.js";
import { DatadogConnector } from "../connectors/datadog.js";
import { correlateEvents } from "../core/correlator.js";
import type { NormalizedEvent, PatternMatch } from "../core/types.js";

const DEFAULT_WINDOW_MINUTES = 15;

interface InvestigationOptions {
  windowMinutes?: number;
  query?: string;
}

function formatEvent(event: NormalizedEvent): string {
  return `${event.timestamp.toISOString()} ${event.source} ${event.type}`;
}

function summarizeMatch(match: PatternMatch): { explanation: string; suggestion: string } {
  switch (match.patternId) {
    case "SERVERLESS_TIMEOUT_CASCADE":
      return {
        explanation:
          "A timeout event was followed by retries and restarts, which indicates a timeout-driven failure cascade.",
        suggestion:
          "Increase timeout budget or reduce downstream latency, then add retry backoff limits to stop repeated retries."
      };
    case "RETRY_STORM":
      return {
        explanation:
          "Multiple retries for the same workload appeared in a short window, which indicates a retry storm.",
        suggestion:
          "Throttle retries for the affected job and cap max attempts while investigating the first retry trigger."
      };
    case "DEPLOY_FAILURE":
      return {
        explanation:
          "Errors increased immediately after a deployment event, which points to a deployment-linked regression.",
        suggestion:
          "Rollback or compare the deployed revision against the previous release and validate dependent config changes."
      };
    case "CRASH_LOOP":
      return {
        explanation:
          "Repeated restart events were detected in sequence, which indicates a crash-loop condition.",
        suggestion:
          "Inspect process startup logs and health checks for the first restart to identify the immediate crash trigger."
      };
    default:
      return {
        explanation: `Detected pattern ${match.patternId}.`,
        suggestion: "Inspect the root cause event and the immediate cascade to verify the failure path."
      };
  }
}

export async function runInvestigation(options: InvestigationOptions = {}): Promise<void> {
  const config = await loadConfig();
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
  const connectors = [
    new TriggerConnector(config),
    new LocalConnector(),
    new DatadogConnector(config)
  ];

  console.log(`🐸 Scanning last ${windowMinutes} minutes...`);

  const connectorResults = await Promise.allSettled(
    connectors.map((connector) => connector.fetchEvents(windowStart, options.query))
  );
  const flattened: NormalizedEvent[] = [];

  connectorResults.forEach((result, index) => {
    const connectorName = connectors[index]?.name ?? `connector-${index}`;
    if (result.status === "fulfilled") {
      flattened.push(...result.value);
      return;
    }
    console.error(`Connector ${connectorName} failed:`, result.reason);
  });

  if (options.query?.trim()) {
    console.log(`Query bias: "${options.query.trim()}"`);
  }

  const report = correlateEvents(flattened);

  if (!report) {
    console.log("🐸 No significant failure patterns detected.");
    return;
  }

  const explanation = summarizeMatch(report.match);

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
