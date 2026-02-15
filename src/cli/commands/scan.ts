import { Command } from "commander";
import { runInvestigation } from "../../core/investigator.js";

export const scanCommand = new Command("scan")
  .description("run deterministic incident scan")
  .action(() => runInvestigation());
