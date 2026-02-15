import { Command } from "commander";
import prompts, { PromptObject } from "prompts";
import { loadConfig } from "../../config/load.js";
import { saveConfig } from "../../config/save.js";
import type { FrogConfig, LangSmithConfig } from "../../core/types.js";

const menuChoices = [
  { title: "Vercel", value: "vercel" },
  { title: "Trigger.dev", value: "trigger" },
  { title: "Datadog", value: "datadog" },
  { title: "LangSmith", value: "langsmith" },
  { title: "LLM provider", value: "llmProvider" },
  { title: "Show configuration", value: "show" },
  { title: "Done", value: "done" }
];

const promptCredentials = async <T extends Record<string, string | undefined>>(
  questions: PromptObject<string>[]
): Promise<T> => {
  const answers = (await prompts(questions)) as T;
  return answers;
};

const vqlQuestions: PromptObject<string>[] = [
  {
    type: "text",
    name: "vercelToken",
    message: "Vercel token",
    initial: ""
  }
];

const triggerQuestions: PromptObject<string>[] = [
  {
    type: "text",
    name: "triggerToken",
    message: "Trigger.dev API key",
    initial: ""
  }
];

const datadogQuestions: PromptObject<string>[] = [
  {
    type: "text",
    name: "apiKey",
    message: "Datadog API key for MCP",
    initial: ""
  },
  {
    type: "text",
    name: "appKey",
    message: "Datadog Application key",
    initial: ""
  },
  {
    type: "text",
    name: "site",
    message: "Datadog site",
    initial: "datadoghq.com"
  },
  {
    type: "text",
    name: "logsSite",
    message: "Datadog logs site (optional)",
    initial: ""
  },
  {
    type: "text",
    name: "metricsSite",
    message: "Datadog metrics site (optional)",
    initial: ""
  },
  {
    type: "text",
    name: "command",
    message: "Datadog MCP command",
    initial: "datadog-mcp-server"
  },
  {
    type: "text",
    name: "args",
    message: "Additional args for Datadog command",
    initial: ""
  }
];

const langsmithQuestions: PromptObject<string>[] = [
  {
    type: "text",
    name: "apiKey",
    message: "LangSmith API key",
    initial: ""
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

const llmProviderChoices = [
  { title: "openai", value: "openai" },
  { title: "anthropic", value: "anthropic" },
  { title: "custom", value: "custom" }
];

const llmProviderQuestions: PromptObject<string>[] = [
  {
    type: "select",
    name: "provider",
    message: "LLM provider",
    choices: llmProviderChoices,
    initial: 0
  },
  {
    type: "text",
    name: "endpoint",
    message: "Provider endpoint or MCP URL (optional)",
    initial: "https://api.openai.com/v1"
  },
  {
    type: "text",
    name: "model",
    message: "Default model",
    initial: "gpt-4o-mini"
  },
  {
    type: "text",
    name: "systemPrompt",
    message: "System prompt (optional)",
    initial: "You are Frogo, an incident investigator. Answer concisely."
  }
];

function trimOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function configureDatadog(config: FrogConfig): Promise<FrogConfig> {
  const answers = await promptCredentials<Record<string, string>>(datadogQuestions);
  return {
    ...config,
    datadog: {
      apiKey: trimOrUndefined(answers.apiKey),
      appKey: trimOrUndefined(answers.appKey),
      site: trimOrUndefined(answers.site),
      logsSite: trimOrUndefined(answers.logsSite),
      metricsSite: trimOrUndefined(answers.metricsSite),
      command: trimOrUndefined(answers.command),
      args: answers.args ? answers.args.split(" ").filter(Boolean) : undefined
    }
  };
}

async function configureLangSmith(config: FrogConfig): Promise<FrogConfig> {
  const answers = await promptCredentials<Record<string, string>>(langsmithQuestions);
  return {
    ...config,
    langsmith: {
      apiKey: trimOrUndefined(answers.apiKey),
      workspaceKey: trimOrUndefined(answers.workspaceKey),
      mcpUrl: trimOrUndefined(answers.mcpUrl)
    }
  };
}

async function configureLLMProvider(config: FrogConfig): Promise<FrogConfig> {
  const answers = await promptCredentials<Record<string, string>>(llmProviderQuestions);
  return {
    ...config,
    llmProvider: {
      provider: trimOrUndefined(answers.provider),
      endpoint: trimOrUndefined(answers.endpoint),
      model: trimOrUndefined(answers.model),
      systemPrompt: trimOrUndefined(answers.systemPrompt)
    }
  };
}

async function showConfig(config: FrogConfig) {
  console.log("Current configuration:");
  console.log(JSON.stringify(config, null, 2));
}

async function configure(cmd: Command) {
  let config = await loadConfig();
  console.log("🐸 Frog configure — pick an integration to update");

  while (true) {
    const { choice } = (await promptCredentials<Record<string, string>>([
      {
        type: "select",
        name: "choice",
        message: "What would you like to configure?",
        choices: menuChoices
      }
    ])) as { choice?: string };

    if (!choice) {
      console.log("Configuration aborted.");
      break;
    }

    if (choice === "done") {
      await saveConfig(config);
      console.log("🐸 Configuration saved.");
      break;
    }

    if (choice === "show") {
      await showConfig(config);
      continue;
    }

    switch (choice) {
      case "vercel":
        config = {
          ...config,
          vercelToken: trimOrUndefined((await promptCredentials<Record<string, string>>(vqlQuestions)).vercelToken)
        };
        await saveConfig(config);
        console.log("✔ Vercel token updated.");
        break;
      case "trigger":
        config = {
          ...config,
          triggerToken: trimOrUndefined((await promptCredentials<Record<string, string>>(triggerQuestions)).triggerToken)
        };
        await saveConfig(config);
        console.log("✔ Trigger.dev API key updated.");
        break;
      case "datadog":
        config = await configureDatadog(config);
        await saveConfig(config);
        console.log("✔ Datadog MCP config updated.");
        break;
      case "langsmith":
        config = await configureLangSmith(config);
        await saveConfig(config);
        console.log("✔ LangSmith MCP config updated.");
        break;
      case "llmProvider":
        config = await configureLLMProvider(config);
        await saveConfig(config);
        console.log("✔ LLM provider updated.");
        console.log("Set `FROGO_AI_API_KEY` (or place it in your `.env`) instead of saving the key to disk.");
        break;
      default:
        console.log(`Unknown option: ${choice}`);
    }
  }
}

export const configureCommand = new Command("configure")
  .description("connect integrations and save config")
  .action(async () => configure(new Command()));
