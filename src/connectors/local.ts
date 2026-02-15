import fs from "node:fs/promises";
import path from "node:path";
import { Connector, FrogConfig, NormalizedEvent } from "../core/types.js";

export class LocalConnector implements Connector {
  name = "local";

  constructor(private config: FrogConfig) {}

  async fetchEvents(since: Date): Promise<NormalizedEvent[]> {
    const manualPath = process.env.FROGO_LOCAL_EVENTS;
    if (!manualPath) {
      return [];
    }

    try {
      const resolved = path.resolve(process.cwd(), manualPath);
      const raw = await fs.readFile(resolved, "utf-8");
      const parsed = JSON.parse(raw) as Array<NormalizedEvent & { timestamp: string }>;
      return parsed
        .map((event) => ({ ...event, timestamp: new Date(event.timestamp) }))
        .filter((event) => event.timestamp.getTime() >= since.getTime());
    } catch (error) {
      return [];
    }
  }
}
