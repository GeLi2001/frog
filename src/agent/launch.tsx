import "dotenv/config";
import crypto from "node:crypto";
import { render } from "ink";
import { ToolLoopAgent, stepCountIs, type LanguageModel, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "../config/load.js";
import type { FrogConfig, LangSmithConfig, SentryConfig } from "../core/types.js";
import { getSentryOAuthProvider, hasSentryTokens } from "../mcp/sentry-auth.js";
import { FrogoChatApp } from "./ui.js";

const DEFAULT_SYSTEM_PROMPT =
  "You are Frogo, a deterministic incident investigator. Respond concisely, cite evidence, and avoid hallucinations. " +
  "If the user says 'do a pass' or 'anything you can get', fetch a minimal overview: projects, recent runs, datasets, and prompts (if available) " +
  "using MCP tools, then summarize what you found.";
const DATADOG_MCP_COMMAND = "datadog-mcp-server";
const LANGSMITH_API_KEY_ENV = "FROGO_LANGSMITH_API_KEY";
const DATADOG_API_KEY_ENV = "FROGO_DATADOG_API_KEY";
const DATADOG_APP_KEY_ENV = "FROGO_DATADOG_APP_KEY";
let warnedLegacyLangSmithSecret = false;
let warnedLegacyDatadogSecrets = false;

type ProviderContext = {
  languageModel: LanguageModel;
  systemPrompt: string;
};

type McpToolContext = {
  name: string;
  tools: ToolSet;
  client: MCPClient;
};


function buildProviderContext(config: FrogConfig): ProviderContext | null {
  const apiKey = process.env.FROGO_AI_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set FROGO_AI_API_KEY (or add it to your .env) before running Frogo.");
    return null;
  }

  const providerName = (config.llmProvider?.provider ?? process.env.FROGO_AI_PROVIDER ?? "openai").toLowerCase();
  const modelId = config.llmProvider?.model ?? process.env.FROGO_AI_MODEL ?? "gpt-4o-mini";
  const endpoint = config.llmProvider?.endpoint ?? process.env.FROGO_AI_ENDPOINT;
  const systemPrompt = config.llmProvider?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  let languageModel: LanguageModel;
  if (providerName === "anthropic") {
    const provider = createAnthropic({ apiKey, baseURL: endpoint });
    languageModel = provider(modelId);
  } else {
    const provider = createOpenAI({ apiKey, baseURL: endpoint });
    languageModel = provider(modelId);
  }

  return { languageModel, systemPrompt };
}

function prefersSse(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("does not support http transport");
}

async function createLangSmithClient(langsmith: LangSmithConfig, apiKey: string): Promise<MCPClient> {
  const headers: Record<string, string> = {
    "LANGSMITH-API-KEY": apiKey
  };
  if (langsmith.workspaceKey) {
    headers["LANGSMITH-WORKSPACE-ID"] = langsmith.workspaceKey;
  }

  const baseConfig = {
    headers
  };

  try {
    return await createMCPClient({
      transport: {
        type: "http",
        url: langsmith.mcpUrl!,
        ...baseConfig
      }
    });
  } catch (error) {
    if (prefersSse(error)) {
      return await createMCPClient({
        transport: {
          type: "sse",
          url: langsmith.mcpUrl!,
          ...baseConfig
        }
      });
    }
    throw error;
  }
}

async function buildLangSmithToolContext(config: FrogConfig): Promise<McpToolContext | null> {
  const langsmith = config.langsmith;
  const apiKey = process.env[LANGSMITH_API_KEY_ENV]?.trim() ?? langsmith?.apiKey?.trim();
  if (!apiKey || !langsmith?.mcpUrl) {
    return null;
  }

  if (langsmith?.apiKey && !warnedLegacyLangSmithSecret) {
    console.warn(`LangSmith API key loaded from config. Prefer ${LANGSMITH_API_KEY_ENV} env var.`);
    warnedLegacyLangSmithSecret = true;
  }

  try {
    const client = await createLangSmithClient(langsmith, apiKey);

    const tools = await client.tools();
    return { name: "LangSmith", tools, client };
  } catch (error) {
    console.error("LangSmith MCP initialization failed:", error);
    return null;
  }
}

async function createSentryClient(sentry: SentryConfig): Promise<MCPClient> {
  const { provider } = await getSentryOAuthProvider();
  return await createMCPClient({
    transport: {
      type: "http",
      url: sentry.mcpUrl!,
      authProvider: provider
    }
  });
}

async function buildSentryToolContext(config: FrogConfig): Promise<McpToolContext | null> {
  const sentry = config.sentry;
  if (!sentry?.mcpUrl) {
    return null;
  }

  try {
    const hasTokens = await hasSentryTokens();
    if (!hasTokens) {
      console.log("↳ Sentry not authenticated. Run `frogo configure` to complete OAuth.");
      return null;
    }
    const client = await createSentryClient(sentry);
    const tools = await client.tools();
    return { name: "Sentry", tools, client };
  } catch (error) {
    console.error("Sentry MCP initialization failed:", error);
    return null;
  }
}

async function buildTriggerMcpToolContext(config: FrogConfig): Promise<McpToolContext | null> {
  const triggerMcp = config.triggerMcp;
  if (!triggerMcp?.command || !triggerMcp?.args || triggerMcp.args.length === 0) {
    return null;
  }

  try {
    const transport = new StdioClientTransport({
      command: triggerMcp.command,
      args: triggerMcp.args,
      env: { ...process.env } as Record<string, string>,
      stderr: "inherit"
    });
    const client = await createMCPClient({
      transport,
      name: "frogo-trigger",
      version: "0.1.0"
    });
    const tools = await client.tools();
    return { name: "Trigger", tools, client };
  } catch (error) {
    console.error("Trigger MCP initialization failed:", error);
    return null;
  }
}
async function buildDatadogToolContext(config: FrogConfig): Promise<McpToolContext | null> {
  const datadog = config.datadog ?? ({} as NonNullable<FrogConfig["datadog"]>);
  const apiKey = process.env[DATADOG_API_KEY_ENV]?.trim() ?? datadog?.apiKey?.trim();
  const appKey = process.env[DATADOG_APP_KEY_ENV]?.trim() ?? datadog?.appKey?.trim();
  if (!apiKey || !appKey) {
    return null;
  }

  if ((datadog?.apiKey || datadog?.appKey) && !warnedLegacyDatadogSecrets) {
    console.warn(
      `Datadog credentials loaded from config. Prefer ${DATADOG_API_KEY_ENV} and ${DATADOG_APP_KEY_ENV} env vars.`
    );
    warnedLegacyDatadogSecrets = true;
  }

  const env: Record<string, string> = {
    DD_API_KEY: apiKey,
    DD_APP_KEY: appKey,
    DD_SITE: datadog.site ?? process.env.DD_SITE ?? "datadoghq.com"
  };

  if (datadog.logsSite) {
    env.DD_LOGS_SITE = datadog.logsSite;
  }

  if (datadog.metricsSite) {
    env.DD_METRICS_SITE = datadog.metricsSite;
  }

  const transport = new StdioClientTransport({
    command: datadog.command ?? DATADOG_MCP_COMMAND,
    args: datadog.args ?? [],
    env,
    stderr: "inherit"
  });

  try {
    const client = await createMCPClient({
      transport,
      name: "frogo-datadog",
      version: "0.1.0"
    });

    const tools = await client.tools();
    return { name: "Datadog", tools, client };
  } catch (error) {
    console.error("Datadog MCP initialization failed:", error);
    await transport.close().catch(() => {
      /* ignore */
    });
    return null;
  }
}

async function buildMcpToolContexts(config: FrogConfig): Promise<McpToolContext[]> {
  const contexts: McpToolContext[] = [];

  const langsmithContext = await buildLangSmithToolContext(config);
  if (langsmithContext) {
    contexts.push(langsmithContext);
  }

  const sentryContext = await buildSentryToolContext(config);
  if (sentryContext) {
    contexts.push(sentryContext);
  }

  const triggerMcpContext = await buildTriggerMcpToolContext(config);
  if (triggerMcpContext) {
    contexts.push(triggerMcpContext);
  }

  const datadogContext = await buildDatadogToolContext(config);
  if (datadogContext) {
    contexts.push(datadogContext);
  }

  return contexts;
}

function combineToolSets(contexts: McpToolContext[]): ToolSet {
  return contexts.reduce((acc, context) => ({ ...acc, ...context.tools }), {});
}

async function cleanupMcpContexts(contexts: McpToolContext[]): Promise<void> {
  await Promise.all(
    contexts.map(async (context) => {
      try {
        await context.client.close();
      } catch (error) {
        console.error(`Failed to close ${context.name} MCP client:`, error);
      }
    })
  );
}

export async function runAgentChat(): Promise<void> {
  const config = await loadConfig();
  const context = buildProviderContext(config);
  if (!context) {
    process.exit(1);
  }

  const mcpContexts = await buildMcpToolContexts(config);
  const toolSet = combineToolSets(mcpContexts);

  const agent = new ToolLoopAgent({
    id: "frogo-agent",
    model: context.languageModel,
    instructions: context.systemPrompt,
    tools: Object.keys(toolSet).length ? toolSet : undefined,
    stopWhen: stepCountIs(1000)
  });

  const sessionId = crypto.randomBytes(8).toString("hex");
  const workdir = process.cwd();
  const modelLabel =
    (context.languageModel as { modelId?: string }).modelId ?? (context.languageModel as any)?.model ?? "unknown";
  const providerLabel = (context.languageModel as any)?.provider ?? "openai";

  const app = render(
    <FrogoChatApp
      agent={agent}
      systemPrompt={context.systemPrompt}
      mcpContexts={mcpContexts}
      modelLabel={modelLabel}
      providerLabel={providerLabel}
      workdir={workdir}
      sessionId={sessionId}
    />
  );

  await app.waitUntilExit();
  await cleanupMcpContexts(mcpContexts);
}
