import "dotenv/config";
import readline from "node:readline/promises";
import crypto from "node:crypto";
import chalk from "chalk";
import { stdin as input, stdout as output } from "node:process";
import { ToolLoopAgent, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "../config/load.js";
import type { FrogConfig, LangSmithConfig } from "../core/types.js";

const DEFAULT_SYSTEM_PROMPT =
  "You are Frogo, a deterministic incident investigator. Respond concisely, cite evidence, and avoid hallucinations. " +
  "If the user says 'do a pass' or 'anything you can get', fetch a minimal overview: projects, recent runs, datasets, and prompts (if available) " +
  "using MCP tools, then summarize what you found.";
const DATADOG_MCP_COMMAND = "datadog-mcp-server";

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

async function createLangSmithClient(langsmith: LangSmithConfig): Promise<MCPClient> {
  const headers: Record<string, string> = {
    "LANGSMITH-API-KEY": langsmith.apiKey!
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
  if (!langsmith?.apiKey || !langsmith?.mcpUrl) {
    return null;
  }

  try {
    const client = await createLangSmithClient(langsmith);

    const tools = await client.tools();
    return { name: "LangSmith", tools, client };
  } catch (error) {
    console.error("LangSmith MCP initialization failed:", error);
    return null;
  }
}

async function buildDatadogToolContext(config: FrogConfig): Promise<McpToolContext | null> {
  const datadog = config.datadog;
  if (!datadog?.apiKey || !datadog?.appKey) {
    return null;
  }

  const env: Record<string, string> = {
    DD_API_KEY: datadog.apiKey,
    DD_APP_KEY: datadog.appKey,
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

function createSpinner(label = "thinking"): { start: () => void; stop: () => void } {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
  let index = 0;
  let handle: NodeJS.Timeout | undefined;
  const isTty = Boolean(process.stdout.isTTY);
  const render = () => {
    const frame = frames[index];
    index = (index + 1) % frames.length;
    process.stdout.write(`\r${chalk.gray(frame)} ${chalk.dim(label)}`);
  };

  return {
    start() {
      if (!isTty) {
        process.stdout.write(`${chalk.dim(label)}...\n`);
        return;
      }
      render();
      handle = setInterval(render, 80);
    },
    stop() {
      if (!isTty) {
        return;
      }
      if (handle) {
        clearInterval(handle);
        handle = undefined;
      }
      process.stdout.write("\r");
      process.stdout.write(" ".repeat(32));
      process.stdout.write("\r");
    }
  };
}

function cleanAssistantOutput(content: string): string {
  return content.replace(/^Agent:\s*/i, "").trim();
}

function renderBanner(context: ProviderContext, mcpContexts: McpToolContext[]): void {
  const sessionId = crypto.randomBytes(8).toString("hex");
  const workdir = process.cwd();
  const providerName =
    (context.languageModel as { modelId?: string }).modelId ?? (context.languageModel as any)?.model ?? "unknown";
  const providerLabel = (context.languageModel as any)?.provider ?? "openai";
  const mcpLabel = mcpContexts.length ? mcpContexts.map((item) => item.name).join(", ") : "none";

  const header = "🐸 Frogo CLI";
  const headerLine = `│ ● ${header} │`;
  const sessionLines = [
    `│ session: ${sessionId} │`,
    `│ ↳ workdir: ${workdir} │`,
    `│ ↳ model: ${providerName} │`,
    `│ ↳ provider: ${providerLabel} │`,
    `│ ↳ mcp: ${mcpLabel} │`
  ];

  const headerWidth = Math.max(headerLine.length, ...sessionLines.map((line) => line.length));
  const drawLine = (text: string) => {
    const padded = text.padEnd(headerWidth - 1, " ");
    return `${padded}│`;
  };

  const top = `╭${"─".repeat(headerWidth - 1)}╮`;
  const bottom = `╰${"─".repeat(headerWidth - 1)}╯`;

  console.log(chalk.gray(top));
  console.log(chalk.gray(drawLine(headerLine)));
  console.log(chalk.gray(bottom));
  console.log(chalk.gray(top));
  sessionLines.forEach((line) => console.log(chalk.gray(drawLine(line))));
  console.log(chalk.gray(bottom));
}

function renderAssistantPrefix(): void {
  process.stdout.write(`${chalk.green("🐸")} `);
}

function formatToolPayload(payload: unknown, max = 400): string {
  try {
    const raw = JSON.stringify(payload);
    if (raw.length <= max) {
      return raw;
    }
    return `${raw.slice(0, max)}…`;
  } catch {
    return "[unserializable]";
  }
}

export async function runAgentChat(): Promise<void> {
  const config = await loadConfig();
  const context = buildProviderContext(config);
  if (!context) {
    process.exit(1);
  }

  const mcpContexts = await buildMcpToolContexts(config);
  renderBanner(context, mcpContexts);

  const toolSet = combineToolSets(mcpContexts);

  const agent = new ToolLoopAgent({
    id: "frogo-agent",
    model: context.languageModel,
    instructions: context.systemPrompt,
    tools: Object.keys(toolSet).length ? toolSet : undefined,
    stopWhen: stepCountIs(1000)
  });

  const rl = readline.createInterface({ input, output });
  const spinner = createSpinner();
  const conversation: ModelMessage[] = [];
  let activeAbort: AbortController | null = null;
  let isGenerating = false;

  console.log(chalk.dim("Type your question and press enter (Ctrl+C to exit)."));

  try {
    rl.on("SIGINT", () => {
      if (isGenerating && activeAbort) {
        activeAbort.abort();
        process.stdout.write(`\n${chalk.dim("↳ you canceled the current response. Ask another question when ready.")}\n`);
        return;
      }
      rl.close();
    });

    while (true) {
      let question: string;
      try {
        question = await rl.question(`${chalk.cyan("›")} `);
      } catch (error) {
        if (error instanceof Error && error.message === "SIGINT") {
          break;
        }
        throw error;
      }

      const trimmed = question.trim();
      if (!trimmed) {
        continue;
      }

      conversation.push({ role: "user", content: trimmed });

      spinner.start();
      isGenerating = true;
      activeAbort = new AbortController();
      let spinnerActive = true;
      let assistantReply = "";
      let prefixPrinted = false;
      let lineOpen = false;
      const ensurePrefix = () => {
        if (!prefixPrinted) {
          renderAssistantPrefix();
          prefixPrinted = true;
          lineOpen = true;
        }
      };
      const ensureNewline = () => {
        if (lineOpen) {
          process.stdout.write("\n");
          lineOpen = false;
          prefixPrinted = false;
        }
      };

      try {
        const streamResult = await agent.stream({
          messages: conversation,
          abortSignal: activeAbort.signal
        });

        for await (const part of streamResult.fullStream) {
          switch (part.type) {
            case "text-delta": {
              if (spinnerActive) {
                spinner.stop();
                spinnerActive = false;
                ensurePrefix();
              }
              ensurePrefix();
              process.stdout.write(part.text);
              assistantReply += part.text;
              break;
            }
            case "tool-call": {
              if (spinnerActive) {
                spinner.stop();
                spinnerActive = false;
              }
              ensureNewline();
              const payload = formatToolPayload(part.input);
              process.stdout.write(
                `${chalk.dim("↳ tool call")} ${chalk.cyan(part.toolName)} ${chalk.dim(payload)}\n`
              );
              break;
            }
            case "tool-result": {
              ensureNewline();
              const payload = formatToolPayload(part.output);
              process.stdout.write(
                `${chalk.dim("↳ tool result")} ${chalk.cyan(part.toolName)} ${chalk.dim(payload)}\n`
              );
              break;
            }
            case "tool-error": {
              ensureNewline();
              process.stdout.write(
                `${chalk.red("↳ tool error")} ${chalk.cyan(part.toolName)} ${chalk.dim(String(part.error))}\n`
              );
              break;
            }
            case "tool-approval-request": {
              ensureNewline();
              process.stdout.write(
                `${chalk.yellow("↳ tool approval")} ${chalk.cyan(part.toolCall.toolName)}\n`
              );
              break;
            }
            case "tool-output-denied": {
              ensureNewline();
              process.stdout.write(
                `${chalk.yellow("↳ tool output denied")} ${chalk.cyan(part.toolName)}\n`
              );
              break;
            }
            default:
              break;
          }
        }

        if (spinnerActive) {
          spinner.stop();
        }
        process.stdout.write("\n");

        const cleaned = cleanAssistantOutput(assistantReply);
        if (cleaned) {
          conversation.push({ role: "assistant", content: cleaned });
        }
      } catch (error) {
        spinner.stop();
        if (activeAbort?.signal.aborted) {
          console.log(`\n${chalk.dim("↳ you canceled the current response. Ask another question when ready.")}`);
        } else {
          console.error("Agent call failed:", error);
          break;
        }
      } finally {
        isGenerating = false;
        activeAbort = null;
      }
    }
  } finally {
    rl.close();
    await cleanupMcpContexts(mcpContexts);
  }
}
