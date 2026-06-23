# @runapi.ai/kling-mcp

RunAPI MCP server for the **Kling** model line. Create tasks,
poll their status, and check pricing through a single RunAPI API key.

## Tools

Each create tool returns the task id, status, output URLs, and a price snapshot,
and (optionally) polls until the task reaches a terminal status.

- `ai_avatar` — create a Kling avatar task. Models: `kling-ai-avatar-pro`, `kling-ai-avatar-standard`, `kling-ai-avatar-v1-pro`, `kling-v1-avatar-standard`.
- `image_to_video` — create a Kling image-to-video task. Models: `kling-v2.1-master-image-to-video`, `kling-v2.1-pro`, `kling-v2.1-standard`, `kling-v2.5-turbo-image-to-video-pro`.
- `motion_control` — create a Kling motion-control task. Models: `kling-3.0`.
- `text_to_video` — create a Kling text-to-video task. Models: `kling-3.0`, `kling-v2.1-master-text-to-video`, `kling-v2.5-turbo-text-to-video-pro`.
- `get_task` — fetch the current status and latest payload for a task.
- `check_pricing` — look up pricing for a model in this line.

## Configuration

Set a RunAPI API key via the `RUNAPI_API_KEY` environment variable, or write
it to `~/.config/runapi/config.json`:

```bash
mkdir -p ~/.config/runapi
echo '{"api_key":"YOUR_KEY"}' > ~/.config/runapi/config.json
```

Get an API key at https://runapi.ai. Pricing is listed at
https://runapi.ai/pricing.

## Usage

Run the server over stdio:

```bash
npx -y @runapi.ai/kling-mcp
```

Add it to an MCP client (see `examples/` for per-client configs):

```json
{
  "mcpServers": {
    "kling": {
      "command": "npx",
      "args": ["-y", "@runapi.ai/kling-mcp"],
      "env": { "RUNAPI_API_KEY": "${RUNAPI_API_KEY}" }
    }
  }
}
```

## License

Apache-2.0
