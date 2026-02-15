import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { ModelMessage, ToolSet, ToolLoopAgent } from "ai";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
};

type McpToolContext = {
  name: string;
  tools: ToolSet;
};

type Props = {
  agent: ToolLoopAgent;
  systemPrompt: string;
  mcpContexts: McpToolContext[];
  modelLabel: string;
  providerLabel: string;
  workdir: string;
  sessionId: string;
};

const makeId = (() => {
  let i = 0;
  return () => `${Date.now()}-${i++}`;
})();

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

function renderHelpLines(): string[] {
  return [
    "Slash commands:",
    "/mcp       List MCP connections and tools",
    "/mcp list  Same as /mcp",
    "/help      Show help",
    "/exit      Exit Frogo"
  ];
}

export function FrogoChatApp(props: Props) {
  const { agent, mcpContexts, modelLabel, providerLabel, workdir, sessionId } = props;
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [slashHint, setSlashHint] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<ModelMessage[]>([]);
  const slashOptions = useMemo(() => ["/mcp", "/help", "/exit"], []);

  const toolSummary = useMemo(() => {
    if (!mcpContexts.length) {
      return "none";
    }
    return mcpContexts.map((ctx) => ctx.name).join(", ");
  }, [mcpContexts]);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages((prev) => prev.map((msg) => (msg.id === id ? { ...msg, content } : msg)));
  }, []);

  useEffect(() => {
    setSlashHint(input === "/");
    if (input !== "/") {
      setSlashIndex(0);
    }
  }, [input]);

  useInput((_, key) => {
    if (!key) return;
    const keyName = (key as { name?: string }).name;
    if (key.ctrl && keyName === "c") {
      if (isGenerating && abortRef.current) {
        abortRef.current.abort();
        addMessage({
          id: makeId(),
          role: "system",
          content: "↳ you canceled the current response. Ask another question when ready."
        });
        return;
      }
      exit();
    }
    if (!isGenerating && slashHint) {
      if (key.upArrow || keyName === "up") {
        setSlashIndex((prev) => (prev - 1 + slashOptions.length) % slashOptions.length);
        setInput("/");
      } else if (key.downArrow || keyName === "down") {
        setSlashIndex((prev) => (prev + 1) % slashOptions.length);
        setInput("/");
      }
    }
  });

  const handleSlashCommand = useCallback(
    (command: string) => {
      if (command === "/" || command === "/help") {
        renderHelpLines().forEach((line) => {
          addMessage({ id: makeId(), role: "system", content: line });
        });
        return true;
      }
      if (command === "/mcp" || command === "/mcp list") {
        if (!mcpContexts.length) {
          addMessage({ id: makeId(), role: "system", content: "No MCP integrations connected." });
          return true;
        }
        mcpContexts.forEach((ctx) => {
          const tools = Object.keys(ctx.tools);
          addMessage({
            id: makeId(),
            role: "system",
            content: `${ctx.name} (${tools.length} tools)`
          });
          if (tools.length) {
            addMessage({
              id: makeId(),
              role: "system",
              content: `tools: ${tools.join(", ")}`
            });
          }
        });
        return true;
      }
      if (command === "/exit") {
        exit();
        return true;
      }
      addMessage({ id: makeId(), role: "system", content: `Unknown command: ${command}` });
      return true;
    },
    [addMessage, exit, mcpContexts]
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      setInput("");
      if (!trimmed) {
        return;
      }
      if (trimmed === "/" && slashHint) {
        handleSlashCommand(slashOptions[slashIndex]);
        return;
      }
      if (slashHint) {
        handleSlashCommand(trimmed);
        return;
      }
      if (trimmed.startsWith("/")) {
        handleSlashCommand(trimmed);
        return;
      }

      addMessage({ id: makeId(), role: "user", content: trimmed });
      conversationRef.current.push({ role: "user", content: trimmed });

      const assistantId = makeId();
      addMessage({ id: assistantId, role: "assistant", content: "" });

      abortRef.current = new AbortController();
      setIsGenerating(true);

      try {
        const streamResult = await agent.stream({
          messages: conversationRef.current,
          abortSignal: abortRef.current.signal
        });

        let assistantContent = "";
        for await (const part of streamResult.fullStream) {
          if (part.type === "text-delta") {
            assistantContent += part.text;
            updateMessage(assistantId, assistantContent);
          } else if (part.type === "tool-call") {
            addMessage({
              id: makeId(),
              role: "tool",
              content: `↳ tool call ${part.toolName} ${formatToolPayload(part.input)}`
            });
          } else if (part.type === "tool-result") {
            addMessage({
              id: makeId(),
              role: "tool",
              content: `↳ tool result ${part.toolName} ${formatToolPayload(part.output)}`
            });
          } else if (part.type === "tool-error") {
            addMessage({
              id: makeId(),
              role: "tool",
              content: `↳ tool error ${part.toolName} ${String(part.error)}`
            });
          } else if ((part as { type?: string }).type === "tool-output-denied") {
            const toolName = (part as { toolName?: string }).toolName ?? "tool";
            addMessage({
              id: makeId(),
              role: "tool",
              content: `↳ tool output denied ${toolName}`
            });
          } else if (part.type === "tool-approval-request") {
            addMessage({
              id: makeId(),
              role: "tool",
              content: `↳ tool approval ${part.toolCall.toolName}`
            });
          }
        }

        const cleaned = assistantContent.replace(/^Agent:\\s*/i, "").trim();
        updateMessage(assistantId, cleaned);
        conversationRef.current.push({ role: "assistant", content: cleaned });
      } catch (error) {
        if (abortRef.current?.signal.aborted) {
          addMessage({
            id: makeId(),
            role: "system",
            content: "↳ you canceled the current response. Ask another question when ready."
          });
        } else {
          addMessage({
            id: makeId(),
            role: "system",
            content: `Agent call failed: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      } finally {
        abortRef.current = null;
        setIsGenerating(false);
      }
    },
    [addMessage, agent, handleSlashCommand, slashHint, slashIndex, slashOptions, updateMessage]
  );

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column">
        <Text color="gray">╭──────────────────────────────────────╮</Text>
        <Text color="gray">│ ● 🐸 Frogo CLI │                    │</Text>
        <Text color="gray">╰──────────────────────────────────────╯</Text>
        <Text color="gray">╭──────────────────────────────────────╮</Text>
        <Text color="gray">│ session: {sessionId} │</Text>
        <Text color="gray">│ ↳ workdir: {workdir} │</Text>
        <Text color="gray">│ ↳ model: {modelLabel} │</Text>
        <Text color="gray">│ ↳ provider: {providerLabel} │</Text>
        <Text color="gray">│ ↳ mcp: {toolSummary} │</Text>
        <Text color="gray">╰──────────────────────────────────────╯</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <Text key={msg.id} color="cyan">
                › {msg.content}
              </Text>
            );
          }
          if (msg.role === "assistant") {
            return (
              <Text key={msg.id} color="green">
                🐸 {msg.content}
              </Text>
            );
          }
          if (msg.role === "tool") {
            return (
              <Text key={msg.id} color="gray">
                {msg.content}
              </Text>
            );
          }
          return (
            <Text key={msg.id} color="gray">
              {msg.content}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="cyan">› </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
        {isGenerating ? (
          <Box marginLeft={1}>
            <Text color="gray">
              <Spinner type="dots" /> thinking
            </Text>
          </Box>
        ) : null}
      </Box>

      {slashHint ? (
        <Box marginTop={1} flexDirection="column">
          {slashOptions.map((option, idx) => (
            <Text key={option} color={idx === slashIndex ? "cyan" : "gray"}>
              {idx === slashIndex ? "› " : "  "}
              {option}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
