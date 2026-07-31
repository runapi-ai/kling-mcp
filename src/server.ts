import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createModelServer,
  CANONICAL_PRICING_URL,
  declaredFieldsForAction,
  findModelForAction,
  findModels,
  friendlyError,
  jsonText,
  lookupRuntimePrice,
  RunApiClient,
  runtimePricingErrorMessage,
  taskStatus,
  validateInputRules,
  validateParams,
  zodShapeForFields,
  type Contract,
  type ContractAction,
  type InputRule,
  type ModelInfo,
  type ModelServerTool,
} from "@runapi.ai/mcp-core";
import { readContract } from "./data.js";
import { META } from "./meta.js";

type RuntimeContractAction = ContractAction & {
  task_type?: "synchronous" | "asynchronous";
};

function taskType(action: ContractAction): "synchronous" | "asynchronous" {
  return (action as RuntimeContractAction).task_type ?? "asynchronous";
}

const KLING_O1_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const KLING_O1_VIDEO_EXTENSIONS = new Set([".mp4", ".mov"]);
const KLING_O1_BLOCKED_IP_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
  "::/128",
  "::1/128",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "2001::/32",
  "2001:2::/48",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8"
] as const;

type KlingParsedIp = { bits: 32 | 128; value: bigint };

const KLING_O1_BLOCKED_IP_NETWORKS = KLING_O1_BLOCKED_IP_CIDRS.map((cidr) => {
  const [address, prefixText] = cidr.split("/");
  const parsed = klingParseIpLiteral(address);
  if (!parsed) throw new Error("Invalid blocked IP range: " + cidr);
  return { ...parsed, prefix: Number(prefixText) };
});

function validateKlingRequest(action: string, params: Record<string, unknown>): string | undefined {
  if (params.model === "kling-o1" && ["text_to_video", "image_to_video"].includes(action)) {
    return validateKlingO1References(params);
  }

  if (params.model === "kling-v2.6") {
    const mode = params.mode ?? "std";
    if (params.enable_sound === true && mode !== "pro") {
      return "enable_sound requires mode pro for kling-v2.6";
    }
    if (action !== "image_to_video" || typeof params.last_frame_image_url !== "string" || params.last_frame_image_url.length === 0) {
      return undefined;
    }
    if (mode !== "pro") {
      return "last_frame_image_url requires mode pro for kling-v2.6";
    }
    if ((params.duration_seconds ?? 5) !== 5) {
      return "last_frame_image_url requires duration_seconds 5 for kling-v2.6";
    }
    return undefined;
  }

  if (params.model !== "kling-v3-omni") return undefined;
  if (action !== "image_to_video" || typeof params.last_frame_image_url !== "string" || params.last_frame_image_url.length === 0) {
    return undefined;
  }
  if ((params.duration_seconds ?? 5) !== 5) {
    return "last_frame_image_url requires duration_seconds 5 for kling-v3-omni";
  }
  return undefined;
}

function validateKlingO1References(params: Record<string, unknown>): string | undefined {
  if (params.enable_sound === true) return "enable_sound is not supported by kling-o1";
  if (typeof params.prompt !== "string") return "prompt must be a string";

  for (const field of ["first_frame_image_url", "last_frame_image_url"]) {
    const value = params[field];
    if (typeof value !== "string" || value.length === 0) continue;
    const error = validateKlingMediaUrl(value, field, KLING_O1_IMAGE_EXTENSIONS, "a JPG, JPEG, or PNG URL");
    if (error) return error;
  }

  const prompt = params.prompt;
  const referenceImages = Array.isArray(params.reference_image_urls) ? params.reference_image_urls : [];
  if ("reference_video_url" in params && typeof params.reference_video_url !== "string") {
    return "reference_video_url must be a string";
  }
  const referenceVideoUrl = params.reference_video_url as string | undefined;

  if (klingPresent(params.last_frame_image_url) && (referenceImages.length > 0 || klingPresent(referenceVideoUrl))) {
    return "last_frame_image_url cannot be combined with reference_image_urls or reference_video_url";
  }
  if (referenceVideoUrl && referenceImages.length > 4) {
    return "reference_image_urls must contain at most 4 items when reference_video_url is present";
  }

  for (const [index, value] of referenceImages.entries()) {
    if (typeof value !== "string") return `reference_image_urls[${index}] must be a string`;
    const field = `reference_image_urls[${index}]`;
    const error = validateKlingMediaUrl(value, field, KLING_O1_IMAGE_EXTENSIONS, "a JPG, JPEG, or PNG URL");
    if (error) return error;
    const marker = `<<<image_${index + 1}>>>`;
    if (!prompt.includes(marker)) return `prompt must reference ${field} as ${marker}`;
  }

  for (const match of prompt.matchAll(/<<<image_(\d+)>>>/g)) {
    const index = Number(match[1]);
    if (index < 1 || index > referenceImages.length) return `prompt references missing image_${index}`;
  }

  if (!referenceVideoUrl) {
    if ("reference_video_type" in params) return "reference_video_type requires reference_video_url";
    if ("preserve_reference_video_audio" in params) return "preserve_reference_video_audio requires reference_video_url";
    const marker = prompt.match(/<<<video_([^>]+)>>>/);
    return marker ? `prompt references missing video_${marker[1]}` : undefined;
  }

  const videoError = validateKlingMediaUrl(
    referenceVideoUrl,
    "reference_video_url",
    KLING_O1_VIDEO_EXTENSIONS,
    "an MP4 or MOV URL"
  );
  if (videoError) return videoError;
  if (!prompt.includes("<<<video_1>>>")) {
    return "prompt must reference reference_video_url as <<<video_1>>>";
  }
  for (const match of prompt.matchAll(/<<<video_([^>]+)>>>/g)) {
    if (match[1] !== "1") return "prompt may only reference video_1";
  }

  const referenceVideoType = params.reference_video_type ?? "base";
  if (referenceVideoType === "base" && (klingPresent(params.first_frame_image_url) || klingPresent(params.last_frame_image_url))) {
    return "reference_video_type base cannot be combined with first_frame_image_url or last_frame_image_url";
  }
  return undefined;
}

function validateKlingMediaUrl(
  value: string,
  field: string,
  extensions: Set<string>,
  extensionDescription: string
): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${field} must be a public HTTP or HTTPS URL`;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    klingIsBlockedHost(url.hostname)
  ) {
    return `${field} must be a public HTTP or HTTPS URL`;
  }

  const dot = url.pathname.lastIndexOf(".");
  const extension = dot >= 0 ? url.pathname.slice(dot).toLowerCase() : "";
  return extensions.has(extension) ? undefined : `${field} must use ${extensionDescription}`;
}

function klingIsBlockedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const parsed = klingParseIpLiteral(host);
  if (!parsed) return false;

  return KLING_O1_BLOCKED_IP_NETWORKS.some((network) => {
    if (network.bits !== parsed.bits) return false;
    const shift = BigInt(parsed.bits - network.prefix);
    return (parsed.value >> shift) === (network.value >> shift);
  });
}

function klingParseIpLiteral(value: string): KlingParsedIp | undefined {
  const ipv4 = klingParseIpv4(value);
  if (ipv4 !== undefined) return { bits: 32, value: ipv4 };
  if (!value.includes(":")) return undefined;

  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const head = klingParseIpv6Half(halves[0]);
  const tail = klingParseIpv6Half(halves[1] ?? "");
  if (!head || !tail) return undefined;

  const compressed = halves.length === 2;
  const missing = 8 - head.length - tail.length;
  if ((!compressed && missing !== 0) || (compressed && missing < 1)) return undefined;

  const segments = [...head, ...Array<number>(missing).fill(0), ...tail];
  const address = segments.reduce((result, segment) => (result << 16n) | BigInt(segment), 0n);
  if ((address >> 32n) === 0xffffn) {
    return { bits: 32, value: address & 0xffffffffn };
  }
  return { bits: 128, value: address };
}

function klingParseIpv4(value: string): bigint | undefined {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]+$/.test(part))) return undefined;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return undefined;
  return octets.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
}

function klingParseIpv6Half(value: string): number[] | undefined {
  if (value === "") return [];
  const parts = value.split(":");
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}

function klingPresent(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

class KlingRunApiClient extends RunApiClient {
  override async createTask(service: string, action: string, params: Record<string, unknown>) {
    const error = validateKlingRequest(action, params);
    if (error) throw new Error(`Invalid RunAPI parameters: ${error}`);

    return super.createTask(service, action, params);
  }
}

function lineService(contract: Contract): string {
  return Object.keys(contract.actions)[0]?.split("/")[0] ?? META.lineSlug;
}

function lineEndpoints(contract: Contract, filter?: "synchronous" | "asynchronous"): string[] {
  const seen = new Set<string>();
  for (const action of Object.values(contract.actions)) {
    if (filter && taskType(action) !== filter) {
      continue;
    }
    seen.add(action.endpoint);
  }
  return [...seen];
}

function lineModels(contract: Contract): string[] {
  const seen = new Set<string>();
  for (const action of Object.values(contract.actions)) {
    for (const model of action.models) {
      seen.add(model);
    }
  }
  return [...seen];
}

function rulesForAction(action: ContractAction): InputRule[] {
  return action.rules ?? [];
}

function buildTools(contract: Contract): { tools: ModelServerTool[]; inputRules: Record<string, InputRule[]> } {
  const tools: ModelServerTool[] = [];
  const inputRules: Record<string, InputRule[]> = {};

  for (const [key, action] of Object.entries(contract.actions)) {
    if (taskType(action) === "synchronous") {
      continue;
    }
    const service = key.split("/")[0];
    const endpoint = action.endpoint;
    tools.push({
      name: endpoint,
      description: `Create a ${action.model} task on RunAPI (${endpoint.replace(/_/g, " ")}). Returns a task id, status, and output URLs.`,
      service,
      action: endpoint,
      models: action.models
    });
    inputRules[endpoint] = rulesForAction(action);
  }

  return { tools, inputRules };
}

async function runtimePricingFor(info: ModelInfo, client: RunApiClient) {
  try {
    return await lookupRuntimePrice(client, {
      service: info.service,
      action: info.action,
      model: info.model
    });
  } catch (error) {
    return {
      error: runtimePricingErrorMessage(error),
      pricing_url: CANONICAL_PRICING_URL
    };
  }
}

function registerSynchronousTools(server: McpServer, contract: Contract, client: RunApiClient): void {
  for (const [key, action] of Object.entries(contract.actions)) {
    if (taskType(action) !== "synchronous") {
      continue;
    }

    const service = key.split("/")[0];
    const endpoint = action.endpoint;
    const shape: Record<string, z.ZodTypeAny> = zodShapeForFields(declaredFieldsForAction(action));
    if (action.models.length > 0) {
      shape.model = z.enum(action.models as [string, ...string[]]).optional().describe("RunAPI model slug for this model line.");
    }

    server.tool(
      endpoint,
      `Run a synchronous ${action.model} operation on RunAPI (${endpoint.replace(/_/g, " ")}). Returns the operation result.`,
      shape,
      async (args) => {
        const { model, ...params } = args as Record<string, unknown> & { model?: string };
        try {
          const info = findModelForAction(service, endpoint, model, contract);
          if (!info) {
            return jsonText({
              error: "Unsupported RunAPI service/action/model combination.",
              hint: "This model server was generated for a specific model line; verify the requested model."
            });
          }

          const body = validateParams(info.fields, {
            ...params,
            ...(info.model ? { model: info.model } : {})
          });
          const ruleError = validateInputRules(action.rules ?? [], body);
          if (ruleError) {
            return jsonText({
              error: `Invalid RunAPI parameters: ${ruleError}`,
              hint: "Adjust the parameters to satisfy the endpoint input rules before retrying."
            });
          }

          const result = await client.createTask(service, endpoint, body);
          return jsonText({ result });
        } catch (error) {
          return jsonText({ error: friendlyError(error) });
        }
      }
    );
  }
}

function registerLineTools(server: McpServer, contract: Contract, client: RunApiClient): void {
  const service = lineService(contract);
  const endpoints = lineEndpoints(contract);
  const asynchronousEndpoints = lineEndpoints(contract, "asynchronous");
  const models = lineModels(contract);
  const endpointEnum = endpoints.length > 0 ? z.enum(endpoints as [string, ...string[]]) : z.string();
  const modelEnum = models.length > 0 ? z.enum(models as [string, ...string[]]) : z.string();

  if (asynchronousEndpoints.length > 0) {
    const asynchronousEndpointEnum = z.enum(asynchronousEndpoints as [string, ...string[]]);
    // With one endpoint, action defaults safely. With several, a wrong default
    // would query the wrong task route, so the caller must name the endpoint.
    const getTaskAction = asynchronousEndpoints.length > 1
      ? asynchronousEndpointEnum.describe("Asynchronous endpoint the task was created on.")
      : asynchronousEndpointEnum.optional().describe("Asynchronous endpoint the task was created on. Defaults to the line's only asynchronous endpoint.");

    server.tool(
      "get_task",
      `Fetch the current status and latest result payload for a ${META.lineSlug} task.`,
      {
        task_id: z.string().describe("Task id returned when the task was created."),
        action: getTaskAction
      },
      async ({ task_id, action }) => {
        try {
          const task = await client.getTask(service, task_id, action ?? asynchronousEndpoints[0]);
          return jsonText({ task_id, status: taskStatus(task), task });
        } catch (error) {
          return jsonText({ error: friendlyError(error) });
        }
      }
    );
  }

  server.tool(
    "check_pricing",
    `Look up RunAPI pricing for the ${META.lineSlug} model line.`,
    {
      model: modelEnum.optional().describe("Model slug. Defaults to the line's primary model."),
      action: endpointEnum.optional().describe("Endpoint name. Defaults to the endpoint that offers the model.")
    },
    async ({ model, action }) => {
      const noMatch = { supported: false, message: "No matching model/endpoint in this model line." };

      // Explicit endpoint: price exactly that model on that endpoint.
      if (action) {
        const info = findModelForAction(service, action, model, contract);
        return info
          ? jsonText({ supported: true, model: info.model, service: info.service, action: info.action, price: await runtimePricingFor(info, client) })
          : jsonText(noMatch);
      }

      // No endpoint and no model: price the line's primary model/endpoint.
      if (!model) {
        const info = findModelForAction(service, endpoints[0], undefined, contract);
        return info
          ? jsonText({ supported: true, model: info.model, service: info.service, action: info.action, price: await runtimePricingFor(info, client) })
          : jsonText(noMatch);
      }

      // No endpoint named: a model may be offered on several endpoints at
      // different prices, so report every endpoint that offers it rather than
      // silently pricing only the first one found.
      const matches = findModels(model, contract);
      if (matches.length === 0) {
        return jsonText(noMatch);
      }
      if (matches.length === 1) {
        const info = matches[0];
        return jsonText({ supported: true, model: info.model, service: info.service, action: info.action, price: await runtimePricingFor(info, client) });
      }
      return jsonText({
        supported: true,
        model: matches[0].model,
        service: matches[0].service,
        endpoints: await Promise.all(matches.map(async (info) => ({ action: info.action, price: await runtimePricingFor(info, client) })))
      });
    }
  );
}

export function createServer(): McpServer {
  const contract = readContract();
  const { tools, inputRules } = buildTools(contract);
  const client = new KlingRunApiClient();

  const server = createModelServer({
    name: META.name,
    version: META.version,
    lineSlug: META.lineSlug,
    contract,
    inputRules,
    tools,
    client
  });

  registerSynchronousTools(server, contract, client);
  registerLineTools(server, contract, client);
  return server;
}
