import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Connector, FrogConfig, NormalizedEvent } from "../core/types.js";
import { filterEventsByQuery } from "../core/query-filter.js";

const DEFAULT_LIMIT = 100;

type RawTriggerRun = {
  id?: string;
  status?: string;
  taskIdentifier?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  finishedAt?: string;
  tags?: string[];
  [key: string]: unknown;
};

export class TriggerConnector implements Connector {
  name = "trigger";

  constructor(private config: FrogConfig) {}

  async fetchEvents(since: Date, query?: string): Promise<NormalizedEvent[]> {
    const triggerMcp = this.config.triggerMcp;
    if (!triggerMcp?.command || !triggerMcp.args?.length) {
      return [];
    }

    const transport = new StdioClientTransport({
      command: triggerMcp.command,
      args: triggerMcp.args,
      env: { ...process.env } as Record<string, string>,
      stderr: "inherit"
    });
    const client = new Client({ name: "frogo-trigger-connector", version: "0.1.1" });

    try {
      await client.connect(transport);
      const response = await client.callTool({
        name: "list_runs",
        arguments: {
          from: since.toISOString(),
          limit: DEFAULT_LIMIT
        }
      });

      const runs = this.extractRuns(response);
      const normalized = runs
        .map((run) => this.normalizeRun(run))
        .filter((event) => event.timestamp.getTime() >= since.getTime());

      return filterEventsByQuery(normalized, query);
    } catch (error) {
      console.error("Trigger MCP fetch failed:", error);
      return [];
    } finally {
      await transport.close();
    }
  }

  private extractRuns(response: unknown): RawTriggerRun[] {
    const candidates: unknown[] = [response];
    if (isRecord(response) && Array.isArray(response.content)) {
      for (const item of response.content) {
        if (!isRecord(item)) {
          continue;
        }

        if (item.type === "text" && typeof item.text === "string") {
          const parsed = this.safeParse(item.text);
          if (parsed) {
            candidates.push(parsed);
          }
          continue;
        }

        if ("json" in item) {
          candidates.push(item.json);
        }
      }
    }

    const runs: RawTriggerRun[] = [];
    for (const candidate of candidates) {
      runs.push(...collectRuns(candidate));
    }

    const deduped = new Map<string, RawTriggerRun>();
    runs.forEach((run, index) => {
      const key = String(run.id ?? `${run.taskIdentifier ?? "unknown"}-${run.startedAt ?? run.createdAt ?? index}`);
      deduped.set(key, run);
    });
    return [...deduped.values()];
  }

  private safeParse(raw: string): unknown | null {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private normalizeRun(run: RawTriggerRun): NormalizedEvent {
    const timestampValue =
      run.completedAt ?? run.finishedAt ?? run.startedAt ?? run.createdAt ?? new Date().toISOString();
    const timestamp = new Date(timestampValue);
    const status = String(run.status ?? "unknown").toLowerCase();
    const taskIdentifier = String(run.taskIdentifier ?? "unknown-task");
    const type = `trigger.run.${taskIdentifier}.${status}`;

    return {
      source: "trigger",
      type,
      severity: mapStatusToSeverity(status),
      timestamp,
      metadata: {
        id: run.id,
        status: run.status,
        taskIdentifier: run.taskIdentifier,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? run.finishedAt,
        tags: run.tags,
        raw: run
      }
    };
  }
}

function collectRuns(payload: unknown): RawTriggerRun[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord) as RawTriggerRun[];
  }

  if (!isRecord(payload)) {
    return [];
  }

  const directKeys = ["runs", "data", "items", "results"];
  for (const key of directKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord) as RawTriggerRun[];
    }
  }

  for (const key of directKeys) {
    const value = payload[key];
    if (isRecord(value)) {
      const nested = collectRuns(value);
      if (nested.length) {
        return nested;
      }
    }
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapStatusToSeverity(status: string): "info" | "warn" | "error" {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("crash") ||
    normalized.includes("timeout")
  ) {
    return "error";
  }

  if (normalized.includes("cancel") || normalized.includes("retry")) {
    return "warn";
  }

  return "info";
}
