# Frogo
Production incident investigator CLI that reconstructs cross-service failure timelines and produces a deterministic root-cause hypothesis, with optional MCP-powered log exploration.

## Install
```bash
npx frogo
```

Or install globally:
```bash
npm install -g frogo
```

## Quickstart
1. Configure integrations and the model:
   ```bash
   npx frogo configure
   ```
2. Run the agent chat:
   ```bash
   npx frogo
   ```
3. Run deterministic scans:
   ```bash
   npx frogo scan
   npx frogo debug "why did my worker restart?"
   ```

## Commands
- `frogo`  
  Starts the agent chat (ai-sdk). Uses MCP tools when configured.
- `frogo configure`  
  Interactive configuration for Vercel, Trigger.dev, Datadog, LangSmith, and the LLM provider.
- `frogo scan`  
  Deterministic investigation over the default time window.
- `frogo debug "<query>"`  
  Narrow-window deterministic investigation with a user query bias.
- `frogo mcp login langsmith`  
  Store LangSmith MCP credentials.

## Configuration
Frogo reads from:
- Project config: `.frogo.json`
- Global config: `~/.frogo/config.json`

### LLM provider
Frogo does not store provider API keys in config. Set:
```bash
export FROGO_AI_API_KEY="..."
```

### LangSmith MCP
Use the hosted MCP server:
```
https://langsmith-mcp-server.onrender.com/mcp
```

Frogo sends your key as the `LANGSMITH-API-KEY` header.

### Datadog MCP
Frogo can connect to a Datadog MCP server via stdio. Provide:
```json
{
  "datadog": {
    "apiKey": "...",
    "appKey": "...",
    "command": "datadog-mcp-server"
  }
}
```

## Philosophy
- Deterministic pattern engine first
- LLM explains, never decides root cause
- Normalized events only (no raw logs sent to the model)
- Built to extend with more connectors and patterns

## License
MIT
