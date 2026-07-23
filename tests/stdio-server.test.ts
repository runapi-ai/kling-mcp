import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("kling stdio MCP server", () => {
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let tempHome: string | undefined;

  afterEach(async () => {
    await client?.close();
    await transport?.close();
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
    client = undefined;
    transport = undefined;
    tempHome = undefined;
  });

  it("exposes the model-line tools over the real stdio transport", async () => {
    const tsxPath = [
      path.resolve("node_modules/.bin/tsx"),
      path.resolve("../../node_modules/.bin/tsx")
    ].find((candidate) => fs.existsSync(candidate));
    expect(tsxPath).toBeDefined();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "runapi-mcp-home-"));

    client = new Client({ name: "kling-mcp-test", version: "0.1.0" });
    transport = new StdioClientTransport({
      command: tsxPath!,
      args: ["src/index.ts"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: {
        HOME: tempHome,
        PATH: process.env.PATH || ""
      }
    });

    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["ai_avatar","check_pricing","extend_video","get_task","image_to_video","login","motion_control","text_to_video"]);

    for (const endpoint of []) {
      const tool = tools.tools.find((candidate) => candidate.name === endpoint);
      expect(tool?.inputSchema.properties, `${endpoint} is synchronous and must not expose polling controls`).not.toHaveProperty("wait");
    }

    const pricing = await client.callTool({ name: "check_pricing", arguments: {} });
    const content = pricing.content?.[0];
    if (!content || content.type !== "text") {
      throw new Error("Expected text tool response");
    }
    expect(JSON.parse(content.text)).toMatchObject({ supported: true });

    // Every advertised model must price without naming an endpoint, even one
    // that only lives on a non-primary endpoint of a multi-endpoint line.
    for (const model of ["kling-ai-avatar-pro","kling-ai-avatar-standard","kling-ai-avatar-v1-pro","kling-v1-avatar-standard","kling-v2.5-turbo-image-to-video-pro","kling-v2.5-turbo-text-to-video-pro","kling-v2.1-master-image-to-video","kling-v2.1-pro","kling-v2.1-standard","kling-v2.6","kling-v3-omni","kling-v3-turbo-image-to-video","kling-3.0","kling-v2.1-master-text-to-video","kling-v3-turbo-text-to-video"]) {
      const priced = await client.callTool({ name: "check_pricing", arguments: { model } });
      const pricedContent = priced.content?.[0];
      if (!pricedContent || pricedContent.type !== "text") {
        throw new Error("Expected text tool response");
      }
      expect(JSON.parse(pricedContent.text), `check_pricing should support ${model}`).toMatchObject({ supported: true });
    }

    // A model offered on several endpoints must report every endpoint's price
    // without naming one, not silently price only the first endpoint found.
    const multiEndpointModels: Record<string, string[]> = {"kling-v2.5-turbo-image-to-video-pro":["extend_video","image_to_video"],"kling-v2.5-turbo-text-to-video-pro":["extend_video","text_to_video"],"kling-v2.6":["image_to_video","motion_control","text_to_video"],"kling-v3-omni":["image_to_video","text_to_video"],"kling-3.0":["motion_control","text_to_video"]};
    for (const [model, actions] of Object.entries(multiEndpointModels)) {
      const spread = await client.callTool({ name: "check_pricing", arguments: { model } });
      const spreadContent = spread.content?.[0];
      if (!spreadContent || spreadContent.type !== "text") {
        throw new Error("Expected text tool response");
      }
      const parsed = JSON.parse(spreadContent.text) as { endpoints?: { action: string }[] };
      expect(parsed.endpoints?.map((entry) => entry.action).sort(), `check_pricing should price ${model} on every endpoint`).toEqual([...actions].sort());
    }

          const invalidV26Requests = [
            {
              tool: "text_to_video",
              arguments: { model: "kling-v2.6", prompt: "test", enable_sound: true, wait: false },
              message: "enable_sound requires mode pro for kling-v2.6"
            },
            {
              tool: "image_to_video",
              arguments: {
                model: "kling-v2.6", prompt: "test", first_frame_image_url: "https://cdn.runapi.ai/public/samples/image.jpg",
                last_frame_image_url: "https://cdn.runapi.ai/public/samples/last-frame.jpg", wait: false
              },
              message: "last_frame_image_url requires mode pro for kling-v2.6"
            },
            {
              tool: "image_to_video",
              arguments: {
                model: "kling-v2.6", prompt: "test", first_frame_image_url: "https://cdn.runapi.ai/public/samples/image.jpg",
                last_frame_image_url: "https://cdn.runapi.ai/public/samples/last-frame.jpg", mode: "pro", duration_seconds: 10, wait: false
              },
              message: "last_frame_image_url requires duration_seconds 5 for kling-v2.6"
            }
          ];
          for (const invalid of invalidV26Requests) {
            const response = await client.callTool({ name: invalid.tool, arguments: invalid.arguments });
            const responseContent = response.content?.[0];
            if (!responseContent || responseContent.type !== "text") {
              throw new Error("Expected text tool response");
            }
            expect(JSON.parse(responseContent.text).error).toContain(invalid.message);
          }
          const invalidOmni = await client.callTool({
            name: "image_to_video",
            arguments: {
              model: "kling-v3-omni",
              prompt: "test",
              first_frame_image_url: "https://cdn.runapi.ai/public/samples/portrait.jpg",
              last_frame_image_url: "https://cdn.runapi.ai/public/samples/image.jpg",
              duration_seconds: 7,
              wait: false
            }
          });
          const invalidOmniContent = invalidOmni.content?.[0];
          if (!invalidOmniContent || invalidOmniContent.type !== "text") {
            throw new Error("Expected text tool response");
          }
          expect(JSON.parse(invalidOmniContent.text).error).toContain(
            "last_frame_image_url requires duration_seconds 5 for kling-v3-omni"
          );

  });
});
