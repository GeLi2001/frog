import fs from "node:fs/promises";
import path from "node:path";
import { Connector, NormalizedEvent } from "../core/types.js";
import { filterEventsByQuery } from "../core/query-filter.js";

export class LocalConnector implements Connector {
  name = "local";

  async fetchEvents(since: Date, query?: string): Promise<NormalizedEvent[]> {
    const manualPath = process.env.FROGO_LOCAL_EVENTS;
    if (!manualPath) {
      return [];
    }

    try {
      const resolved = path.resolve(process.cwd(), manualPath);
      const raw = await fs.readFile(resolved, "utf-8");
      const parsed = JSON.parse(raw) as Array<NormalizedEvent & { timestamp: string }>;
      const normalized = parsed
        .map((event) => ({ ...event, timestamp: new Date(event.timestamp) }))
        .filter((event) => event.timestamp.getTime() >= since.getTime());
      return filterEventsByQuery(normalized, query);
    } catch (error) {
      console.error("Failed to load local events:", error);
      return [];
    }
  }
}
