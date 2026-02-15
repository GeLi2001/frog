import { Command } from "commander";
import { runInvestigation } from "../../core/investigator.js";

export const debugCommand = new Command("debug")
  .description("run deterministic investigation against a focused query")
  .argument("query", "natural language prompt")
  .action(async (query: string) => {
    console.log(`🐸 Debugging query: ${query}`);
    await runInvestigation({ windowMinutes: 15, query });
  });
