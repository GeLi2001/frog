import { Command } from "commander";
import prompts, { PromptObject } from "prompts";
import { loadConfig } from "../../config/load.js";
import { saveConfig } from "../../config/save.js";
import type { FrogConfig } from "../../core/types.js";

const LANGSMITH_SERVER = "langsmith";

const langsmithQuestions: PromptObject<string>[] = [
  {
    type: "text",
    name: "workspaceKey",
    message: "LangSmith workspace ID (optional)",
    initial: ""
  },
  {
    type: "text",
    name: "mcpUrl",
    message: "LangSmith MCP URL",
    initial: "https://langsmith-mcp-server.onrender.com/mcp"
  }
];

export const mcpCommand = new Command("mcp").description("manage MCP server integrations");

mcpCommand
  .command("login")
  .description("store MCP settings for a server, e.g. langsmith")
  .argument("server", "name of the MCP server")
  .action(async (server: string) => {
    if (server.toLowerCase() !== LANGSMITH_SERVER) {
      console.log(`Unsupported MCP server: ${server}. Try 'frogo mcp login langsmith'.`);
      return;
    }

    const answers = (await prompts(langsmithQuestions)) as {
      workspaceKey?: string;
      mcpUrl?: string;
    };

    const config = await loadConfig();
    const updated: FrogConfig = {
      ...config,
      langsmith: {
        workspaceKey: answers.workspaceKey?.trim() || undefined,
        mcpUrl: answers.mcpUrl?.trim() || undefined
      }
    };

    await saveConfig(updated);
    console.log("🐸 LangSmith MCP settings saved.");
    console.log("Set FROGO_LANGSMITH_API_KEY in your shell or .env.");
  });
