import { IncidentCluster, NormalizedEvent, PatternMatch } from "./types.js";
import { buildIncidentClusters } from "./timeline.js";
import { matchPattern } from "./pattern-engine.js";

export interface IncidentReport {
  cluster: IncidentCluster;
  match: PatternMatch;
  timeline: NormalizedEvent[];
}

export function correlateEvents(events: NormalizedEvent[]): IncidentReport | null {
  const sortedTimeline = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const clusters = buildIncidentClusters(events);

  for (const cluster of clusters) {
    const match = matchPattern(cluster);
    if (match) {
      return {
        cluster,
        match,
        timeline: sortedTimeline
      };
    }
  }

  return null;
}
