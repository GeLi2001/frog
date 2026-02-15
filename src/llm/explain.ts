import { ExplainInput, ExplainOutput } from "../core/types.js";
import type { NormalizedEvent } from "../core/types.js";

export async function explainIncident(input: ExplainInput): Promise<ExplainOutput> {
  const timelineSummary = input.timeline
    .map((event: NormalizedEvent) => `- ${event.timestamp.toISOString()} ${event.source} ${event.type}`)
    .join("\n");

  const evidenceSummary = input.evidence
    .map((event: NormalizedEvent) => `- ${event.timestamp.toISOString()} ${event.source} ${event.type}`)
    .join("\n");

  const explanation = `Detected pattern ${input.pattern} with confidence ${input.confidence.toFixed(2)}. Root cause event: ${input.rootCauseEvent.type}.`;
  const suggestion = `Review ${input.rootCauseEvent.source} ${input.rootCauseEvent.type} around ${input.rootCauseEvent.timestamp.toISOString()} to mitigate.`;

  return {
    explanation,
    suggestion
  };
}
