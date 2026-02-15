import { Command } from "commander";
import prompts, { PromptObject } from "prompts";
import { loadConfig } from "../../config/load.js";
import { saveConfig } from "../../config/save.js";
import type { FrogConfig } from "../../core/types.js";

const LANGSMITH_SERVER = "langsmith";

const langsmithQuestions: PromptObject<string>[] = [
  {
    type: "text",
    name: "apiKey",
    message: "LangSmith API key (ls_api_key_... or lsv2_pt_...)",
    validate: (value: string) => (value.trim() ? true : "API key is required" )
  },
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
  .description("store credentials for an MCP server, e.g. langsmith")
  .argument("server", "name of the MCP server")
  .action(async (server: string) => {
      if (server.toLowerCase() !== LANGSMITH_SERVER) {
        console.log(`Unsupported MCP server: ${server}. Try 'frogo mcp login langsmith'.`);
      return;
    }

    const answers = (await prompts(langsmithQuestions)) as {
      apiKey?: string;
      workspaceKey?: string;
      mcpUrl?: string;
    };

    if (!answers.apiKey) {
      console.log("LangSmith login canceled.");
      return;
    }

    const config = await loadConfig();
    const updated: FrogConfig = {
      ...config,
      langsmith: {
        apiKey: answers.apiKey.trim(),
        workspaceKey: answers.workspaceKey?.trim() || undefined,
        mcpUrl: answers.mcpUrl?.trim() || undefined
      }
    };

    await saveConfig(updated);
    console.log("🐸 LangSmith MCP credentials saved.");
    console.log("If you plan to use ai-sdk's mcp login CLI, run `npx ai-sdk mcp login langsmith` now.");
  });
