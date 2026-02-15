import { Connector, NormalizedEvent, FrogConfig } from "../core/types.js";

export class TriggerConnector implements Connector {
  name = "trigger";

  constructor(private config: FrogConfig) {}

  async fetchEvents(since: Date): Promise<NormalizedEvent[]> {
    if (!this.config.triggerToken) {
      return [];
    }

    // TODO: implement Trigger.dev API fetch once credentials are available.
    return [];
  }
}
