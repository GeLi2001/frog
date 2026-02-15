import { IncidentCluster, NormalizedEvent } from "./types.js";

const CLUSTER_WINDOW_MS = 15 * 60 * 1000;

export function buildIncidentClusters(events: NormalizedEvent[]): IncidentCluster[] {
  const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const clusters: IncidentCluster[] = [];

  for (const event of sorted) {
    if (event.severity !== "error" && event.severity !== "warn") {
      continue;
    }

    const cascade = sorted.filter((candidate) => {
      const offset = candidate.timestamp.getTime() - event.timestamp.getTime();
      return offset >= 0 && offset <= CLUSTER_WINDOW_MS && candidate !== event;
    });

    const windowEnd = cascade.length
      ? cascade[cascade.length - 1].timestamp
      : event.timestamp;

    clusters.push({
      triggerEvent: event,
      cascade,
      windowStart: event.timestamp,
      windowEnd
    });
  }

  return clusters;
}
