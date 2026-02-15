import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Connector, FrogConfig, NormalizedEvent } from "../core/types.js";

const DEFAULT_COMMAND = "datadog-mcp-server";
const DEFAULT_QUERY = "status:error OR status:warn";
const DEFAULT_LIMIT = 80;

interface RawDatadogLogEntry {
  id: string;
  attributes?: {
    timestamp?: string;
    message?: string;
    status?: string;
    service?: string;
    host?: string;
    logger?: string;
    tags?: string[];
    [key: string]: unknown;
  };
  relationships?: {
    trace?: {
      data?: {
        id: string;
      };
    };
  };
}

interface RawDatadogSearchLogsResponse {
  data?: RawDatadogLogEntry[];
}

export class DatadogConnector implements Connector {
  name = "datadog";

  constructor(private config: FrogConfig) {}

  async fetchEvents(since: Date): Promise<NormalizedEvent[]> {
    const datadog = this.config.datadog;
    if (!datadog?.apiKey || !datadog?.appKey) {
      return [];
    }

    const command = datadog.command ?? DEFAULT_COMMAND;
    const args = datadog.args ?? [];
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    env.DD_API_KEY = datadog.apiKey;
    env.DD_APP_KEY = datadog.appKey;
    env.DD_SITE = datadog.site ?? env.DD_SITE ?? "datadoghq.com";
    if (datadog.logsSite) {
      env.DD_LOGS_SITE = datadog.logsSite;
    }
    if (datadog.metricsSite) {
      env.DD_METRICS_SITE = datadog.metricsSite;
    }

    const transport = new StdioClientTransport({
      command,
      args,
      env,
      stderr: "inherit"
    });

    const client = new Client({ name: "frog-datadog-connector", version: "0.1.0" });

    try {
      await client.connect(transport);

      const response = await client.callTool({
        name: "search-logs",
        arguments: {
          filter: {
            query: datadog.query ?? DEFAULT_QUERY,
            from: since.toISOString(),
            to: new Date().toISOString(),
            indexes: datadog.indexes
          },
          limit: datadog.limit ?? DEFAULT_LIMIT
        }
      });

      const toolResponse = response as { content?: Array<{ type: string; text?: string }> };
      const raw = toolResponse.content?.find((item) => item.type === "text")?.text;
      if (!raw) {
        return [];
      }

      const parsed = this.safeParse(raw);
      if (!parsed) {
        return [];
      }

      return (parsed.data ?? [])
        .map((entry) => this.normalizeEntry(entry))
        .filter((event) => event.timestamp.getTime() >= since.getTime());
    } catch (error) {
      console.error("Datadog MCP fetch failed:", error);
      return [];
    } finally {
      await transport.close();
    }
  }

  private safeParse(raw: string): RawDatadogSearchLogsResponse | null {
    try {
      return JSON.parse(raw) as RawDatadogSearchLogsResponse;
    } catch (error) {
      console.error("Failed to parse Datadog search response", error);
      return null;
    }
  }

  private normalizeEntry(entry: RawDatadogLogEntry): NormalizedEvent {
    const attributes = entry.attributes ?? {};
    const timestamp = attributes.timestamp ? new Date(attributes.timestamp) : new Date();
    return {
      source: "datadog",
      type: attributes.service ? `${attributes.service}.log` : "datadog.log",
      severity: mapSeverity(attributes.status),
      timestamp,
      metadata: {
        id: entry.id,
        message: attributes.message,
        status: attributes.status,
        service: attributes.service,
        host: attributes.host,
        logger: attributes.logger,
        traceId: entry.relationships?.trace?.data?.id,
        tags: attributes.tags,
        raw: entry
      }
    };
  }
}

function mapSeverity(status?: string): "info" | "warn" | "error" {
  if (!status) {
    return "info";
  }

  const normalized = status.toLowerCase();
  if (normalized === "error" || normalized === "critical" || normalized === "fatal") {
    return "error";
  }

  if (normalized === "warn" || normalized === "warning") {
    return "warn";
  }

  return "info";
}
