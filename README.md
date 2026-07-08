<h1 align="center">RunAPI Kling MCP Server</h1>

<p align="center">
  <strong>Kling API access for AI agents: create video generation tasks, poll results, and check pricing through one focused MCP server.</strong>
</p>

<p align="center">
  <sub>Works with Claude Code, Codex, Cursor, Windsurf, VS Code, Roo Code, and any MCP-compatible host.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@runapi.ai/kling-mcp"><img src="https://img.shields.io/npm/v/%40runapi.ai/kling-mcp?style=flat-square&color=blue" alt="npm version"></a>
  <a href="https://github.com/runapi-ai/kling-mcp"><img src="https://img.shields.io/badge/GitHub-runapi--ai%2Fkling--mcp-24292f?style=flat-square" alt="GitHub repository"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/Type-MCP_Server-blue?style=flat-square" alt="MCP Server">
  <img src="https://img.shields.io/badge/Models-11-16a34a?style=flat-square" alt="11 models">
</p>

<p align="center">
  <a href="#install">Install</a> |
  <a href="#tools">Tools</a> |
  <a href="#models">Models</a> |
  <a href="#agent-prompts">Agent Prompts</a> |
  <a href="#configuration">Configuration</a> |
  <a href="#links">Links</a>
</p>

---

## Why This Package?

`@runapi.ai/kling-mcp` is a focused Model Context Protocol server for the **Kling** model line on RunAPI.
It gives MCP-compatible assistants direct access to 4 endpoints and 11 model variants without loading the full RunAPI catalog.

Use this per-model server when an agent should stay scoped to Kling. Use [`@runapi.ai/mcp`](https://github.com/runapi-ai/mcp) when one assistant should discover every RunAPI model line.

---

## Install

Add it to Claude Code:

```bash
claude mcp add kling -s user -- npx -y @runapi.ai/kling-mcp
```

Use project scope when the server should be shared with a repository:

```bash
claude mcp add kling -s project -- npx -y @runapi.ai/kling-mcp
```

Codex, Cursor, Windsurf, VS Code, Roo Code, and other MCP hosts can use the same stdio command:

```json
{
  "mcpServers": {
    "kling": {
      "command": "npx",
      "args": ["-y", "@runapi.ai/kling-mcp"]
    }
  }
}
```

`check_pricing` works before sign-in. For task creation and status polling, ask your assistant to call the `login` tool. It opens a browser login and saves credentials to `~/.config/runapi/config.json`, the same file used by `runapi login`.
Headless and CI hosts can still set `RUNAPI_API_KEY` before starting the MCP host.

Ready-made examples are in [`examples/`](examples/) for Claude, Cursor, Windsurf, VS Code, and Roo Code.

---

## Tools

| Tool | Auth | Purpose |
|---|---|---|
| `ai_avatar` | Yes | Create a Kling ai avatar task and optionally wait for a terminal status. Returns the task id, status, output URLs, and pricing snapshot. |
| `image_to_video` | Yes | Create a Kling image to video task and optionally wait for a terminal status. Returns the task id, status, output URLs, and pricing snapshot. |
| `motion_control` | Yes | Create a Kling motion control task and optionally wait for a terminal status. Returns the task id, status, output URLs, and pricing snapshot. |
| `text_to_video` | Yes | Create a Kling text to video task and optionally wait for a terminal status. Returns the task id, status, output URLs, and pricing snapshot. |
| `get_task` | Yes | Fetch the current status and latest payload for an existing task. |
| `check_pricing` | No | Look up the current pricing snapshot for a Kling model and endpoint. |

---

## Models

Kling covers 11 model variants across 4 endpoints. Each tool accepts the models listed for it:

| Tool | Models |
|---|---|
| `ai_avatar` | `kling-ai-avatar-pro`, `kling-ai-avatar-standard`, `kling-ai-avatar-v1-pro`, `kling-v1-avatar-standard` |
| `image_to_video` | `kling-v2.1-master-image-to-video`, `kling-v2.1-pro`, `kling-v2.1-standard`, `kling-v2.5-turbo-image-to-video-pro` |
| `motion_control` | `kling-3.0` |
| `text_to_video` | `kling-3.0`, `kling-v2.1-master-text-to-video`, `kling-v2.5-turbo-text-to-video-pro` |

Model availability can change between releases. Use `check_pricing` or the [Kling model page](https://runapi.ai/models/kling) for the current catalog view.

---

## Agent Prompts

Ask your assistant in natural language; it can inspect pricing, create the task, and return the task id plus output URLs.

### Create a task

```text
Run a Kling ai avatar task with RunAPI.
```

The assistant can call `check_pricing`, then `ai_avatar`, and return the task id, status, and output URLs.

### Submit without waiting

```text
Create the task but don't wait for it to finish.
```

The assistant calls the create tool with `wait: false` and returns the task id. Check on it later with `get_task`.

### Check pricing before creating

```text
Check current Kling pricing, then create the task if it matches my request.
```

The assistant calls `check_pricing` and can link to the [Kling model page](https://runapi.ai/models/kling) for the canonical catalog entry.

---

## Configuration

The server resolves auth in this order:

1. `RUNAPI_API_KEY` environment variable, useful for headless and CI hosts
2. `~/.config/runapi/config.json`, created by the MCP `login` tool or `runapi login`
3. No key, which still allows `check_pricing`

The config file is normally managed by login. A pre-provisioned headless config can use:

```json
{
  "apiKey": "your_runapi_key"
}
```

Do not commit real API keys.

---

## Links

| Resource | URL |
|---|---|
| Kling model page | [https://runapi.ai/models/kling](https://runapi.ai/models/kling) |
| npm package | [@runapi.ai/kling-mcp](https://www.npmjs.com/package/@runapi.ai/kling-mcp) |
| GitHub repository | [runapi-ai/kling-mcp](https://github.com/runapi-ai/kling-mcp) |
| RunAPI MCP overview | [runapi.ai/mcp](https://runapi.ai/mcp) |
| RunAPI docs | [runapi.ai/docs](https://runapi.ai/docs) |

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
