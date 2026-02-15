import { Connector, NormalizedEvent, FrogConfig } from "../core/types.js";

export class VercelConnector implements Connector {
  name = "vercel";

  constructor(private config: FrogConfig) {}

  async fetchEvents(since: Date): Promise<NormalizedEvent[]> {
    if (!this.config.vercelToken) {
      return [];
    }

    // TODO: hook into the Vercel API once the token and project are configured.
    return [];
  }
}
