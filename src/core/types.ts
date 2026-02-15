export type ConnectorSource = "trigger" | "datadog" | "local" | "langsmith" | "sentry";

export interface NormalizedEvent {
  source: ConnectorSource;
  type: string;
  severity: "info" | "warn" | "error";
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface Connector {
  name: string;
  fetchEvents(since: Date, query?: string): Promise<NormalizedEvent[]>;
}

export interface IncidentCluster {
  triggerEvent: NormalizedEvent;
  cascade: NormalizedEvent[];
  windowStart: Date;
  windowEnd: Date;
}

export type PatternId =
  | "SERVERLESS_TIMEOUT_CASCADE"
  | "RETRY_STORM"
  | "DEPLOY_FAILURE"
  | "CRASH_LOOP";

export interface PatternMatch {
  patternId: PatternId;
  rootCauseEvent: NormalizedEvent;
  evidence: NormalizedEvent[];
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface DatadogConfig {
  apiKey?: string;
  appKey?: string;
  site?: string;
  logsSite?: string;
  metricsSite?: string;
  command?: string;
  args?: string[];
  query?: string;
  indexes?: string[];
  limit?: number;
}

export interface LangSmithConfig {
  apiKey?: string;
  workspaceKey?: string;
  mcpUrl?: string;
  toolFilters?: string[];
}

export interface SentryConfig {
  mcpUrl?: string;
  command?: string;
  args?: string[];
}

export interface TriggerMcpConfig {
  command?: string;
  args?: string[];
}

export interface LLMProviderConfig {
  provider?: string;
  endpoint?: string;
  model?: string;
  transport?: string;
  systemPrompt?: string;
}

export interface FrogConfig {
  triggerToken?: string;
  triggerMcp?: TriggerMcpConfig;
  datadog?: DatadogConfig;
  langsmith?: LangSmithConfig;
  sentry?: SentryConfig;
  llmProvider?: LLMProviderConfig;
  detected?: {
    trigger?: boolean;
    env?: boolean;
    aws?: boolean;
  };
  lastRunAt?: string;
}
