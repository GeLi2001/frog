export type ConnectorSource = "vercel" | "trigger" | "datadog" | "local" | "langsmith";

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

export interface LLMProviderConfig {
  provider?: string;
  endpoint?: string;
  model?: string;
  transport?: string;
  systemPrompt?: string;
}

export interface FrogConfig {
  vercelToken?: string;
  triggerToken?: string;
  datadog?: DatadogConfig;
  langsmith?: LangSmithConfig;
  llmProvider?: LLMProviderConfig;
  detected?: {
    vercel?: boolean;
    trigger?: boolean;
    env?: boolean;
    aws?: boolean;
  };
  lastRunAt?: string;
}

export interface ExplainInput {
  pattern: PatternId;
  timeline: NormalizedEvent[];
  evidence: NormalizedEvent[];
  confidence: number;
  rootCauseEvent: NormalizedEvent;
  query?: string;
}

export interface ExplainOutput {
  explanation: string;
  suggestion: string;
}
