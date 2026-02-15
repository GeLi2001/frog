import { IncidentCluster, NormalizedEvent, PatternId, PatternMatch } from "./types.js";

const patternMatchers: Array<(cluster: IncidentCluster) => PatternMatch | null> = [
  matchServerlessTimeoutCascade,
  matchRetryStorm,
  matchDeployFailure,
  matchCrashLoop
];

export function matchPattern(cluster: IncidentCluster): PatternMatch | null {
  for (const matcher of patternMatchers) {
    const match = matcher(cluster);
    if (match) {
      return match;
    }
  }
  return null;
}

function matchServerlessTimeoutCascade(cluster: IncidentCluster): PatternMatch | null {
  const { triggerEvent, cascade } = cluster;
  if (!triggerEvent.type.toLowerCase().includes("timeout")) {
    return null;
  }

  const evidence = [
    triggerEvent,
    ...cascade.filter((event: NormalizedEvent) => isRetry(event) || isRestart(event) || isExternal429(event))
  ];
  const hasRetry = cascade.some(isRetry);
  const hasRestart = cascade.some(isRestart);

  if (!hasRetry) {
    return null;
  }

  const confidence = hasRestart ? 0.87 : 0.82;

  return buildMatch("SERVERLESS_TIMEOUT_CASCADE", triggerEvent, evidence, confidence, {
    retryCount: cascade.filter(isRetry).length,
    restartDetected: hasRestart
  });
}

function matchRetryStorm(cluster: IncidentCluster): PatternMatch | null {
  const { cascade } = cluster;
  const retries = cascade.filter((event) => isRetry(event));
  if (retries.length < 3) {
    return null;
  }

  const grouped = groupBy(retries, (event: NormalizedEvent) => String(event.metadata.jobName ?? "unknown"));
  const hasBusyJob = Object.values(grouped).some((jobs) => jobs.length >= 3);
  if (!hasBusyJob) {
    return null;
  }

  const root = retries[0];
  const evidence = retries.slice(0, 5);
  return buildMatch("RETRY_STORM", root, evidence, 0.74, {
    retries: retries.length,
    jobs: Object.keys(grouped)
  });
}

function matchDeployFailure(cluster: IncidentCluster): PatternMatch | null {
  const timeline = [cluster.triggerEvent, ...cluster.cascade];
  const deployEvent = timeline.find((event: NormalizedEvent) => event.type.toLowerCase().includes("deploy"));
  if (!deployEvent) {
    return null;
  }

  const errorsAfterDeployment = timeline.filter(
    (event: NormalizedEvent) =>
      event.timestamp.getTime() >= deployEvent.timestamp.getTime() && event.severity === "error"
  );
  if (errorsAfterDeployment.length === 0) {
    return null;
  }

  return buildMatch("DEPLOY_FAILURE", deployEvent, errorsAfterDeployment, 0.72, {
    deployEventType: deployEvent.type,
    errorCount: errorsAfterDeployment.length
  });
}

function matchCrashLoop(cluster: IncidentCluster): PatternMatch | null {
  const restarts = cluster.cascade.filter((event: NormalizedEvent) => isRestart(event));
  if (restarts.length < 2) {
    return null;
  }

  const root = restarts[0];
  const evidence = restarts.slice(0, 3);
  return buildMatch("CRASH_LOOP", root, evidence, 0.66, {
    restartCount: restarts.length
  });
}

function isRetry(event: NormalizedEvent): boolean {
  return event.type.toLowerCase().includes("retry") || event.metadata?.retry === true;
}

function isRestart(event: NormalizedEvent): boolean {
  return event.type.toLowerCase().includes("restart") || event.type.toLowerCase().includes("duplicate execution");
}

function isExternal429(event: NormalizedEvent): boolean {
  return event.metadata?.status === 429 || String(event.metadata?.statusCode ?? "").startsWith("429");
}

function groupBy<T>(list: T[], select: (item: T) => string): Record<string, T[]> {
  return list.reduce((acc, item) => {
    const key = select(item);
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

function buildMatch(
  patternId: PatternId,
  rootCauseEvent: NormalizedEvent,
  evidence: NormalizedEvent[],
  confidence: number,
  metadata: Record<string, unknown>
): PatternMatch {
  return {
    patternId,
    rootCauseEvent,
    evidence,
    confidence,
    metadata
  };
}
