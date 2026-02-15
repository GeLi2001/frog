#!/usr/bin/env node
import { Command } from "commander";
import { configureCommand } from "./commands/configure.js";
import { debugCommand } from "./commands/debug.js";
import { scanCommand } from "./commands/scan.js";
import { runAgentChat } from "../agent/launch.js";
import { mcpCommand } from "./commands/mcp.js";

const program = new Command();

program.name("frogo");
program.description("Frogo v0 — incident investigator CLI");
program.version("0.1.1");

program.addCommand(configureCommand);
program.addCommand(scanCommand);
program.addCommand(debugCommand);
program.addCommand(mcpCommand);

program.action(() => {
  runAgentChat().catch((error) => {
    console.error("Agent process failed:", error);
    process.exit(1);
  });
});

program.parse();
