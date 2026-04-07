import { readFile } from "node:fs/promises";

import type { GatewayProviderConfig, GatewayProviderConfigInput, ModelOverride } from "./types.js";

export const DEFAULT_PROVIDER_ALIASES: Record<string, string[]> = {
	alibaba: ["alibaba", "alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-cn"],
	anthropic: ["anthropic"],
	minimax: ["minimax", "minimax-coding-plan"],
	opencode: ["opencode"],
	openai: ["openai"],
	"openai-responses": ["openai-responses", "openai"],
	qwen: ["qwen", "alibaba", "alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-cn"],
	zai: ["z-ai", "zai", "zai-coding-plan", "zhipuai"],
};

export const DEFAULT_CONFIG: GatewayProviderConfig = {
	providerName: "gateway-provider",
	baseUrl: "",
	apiKey: "-",
	modelsPath: "/models",
	modelsDev: {
		enabled: true,
		url: "https://models.dev/api.json",
		cacheTtlMs: 60 * 60 * 1000,
		providerAliases: DEFAULT_PROVIDER_ALIASES,
	},
	heuristics: {
		defaultApi: "openai-completions",
		providerLabelInName: true,
		apiRules: [
			{
				match: ["anthropic", "/v1/messages"],
				api: "anthropic-messages",
			},
			{
				match: ["responses", "openai-responses", "/v1/responses"],
				api: "openai-responses",
			},
		],
		reasoningTokens: ["gpt-5", "claude", "glm", "kimi", "qwen", "minimax", "codex", "opus", "sonnet", "haiku"],
		imageTokens: ["vision", "-vl"],
		contextWindowRules: [
			{ match: ["gpt-5"], value: 128000 },
			{ match: ["claude"], value: 200000 },
			{ match: ["glm", "qwen", "kimi"], value: 262144 },
		],
		maxTokensRules: [
			{ match: ["gpt-5"], value: 32768 },
			{ match: ["claude"], value: 16384 },
		],
	},
	modelOverrides: {},
};

function mergeProviderAliases(
	base: Record<string, string[]>,
	incoming: Record<string, string[]> | undefined,
): Record<string, string[]> {
	const merged: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(base)) {
		merged[key] = [...value];
	}
	for (const [key, value] of Object.entries(incoming ?? {})) {
		const existing = new Set(merged[key] ?? []);
		for (const alias of value) existing.add(alias);
		merged[key] = [...existing];
	}
	return merged;
}

function mergeModelOverrides(base: Record<string, ModelOverride>, incoming: Record<string, ModelOverride> | undefined) {
	const merged: Record<string, ModelOverride> = { ...base };
	for (const [modelId, override] of Object.entries(incoming ?? {})) {
		merged[modelId] = {
			...(merged[modelId] ?? {}),
			...override,
		};
	}
	return merged;
}

export function defineGatewayProviderConfig(input: GatewayProviderConfigInput): GatewayProviderConfig {
	return {
		providerName: input.providerName ?? DEFAULT_CONFIG.providerName,
		baseUrl: input.baseUrl ?? DEFAULT_CONFIG.baseUrl,
		apiKey: input.apiKey ?? DEFAULT_CONFIG.apiKey,
		modelsPath: input.modelsPath ?? DEFAULT_CONFIG.modelsPath,
		modelsDev: {
			enabled: input.modelsDev?.enabled ?? DEFAULT_CONFIG.modelsDev.enabled,
			url: input.modelsDev?.url ?? DEFAULT_CONFIG.modelsDev.url,
			cacheTtlMs: input.modelsDev?.cacheTtlMs ?? DEFAULT_CONFIG.modelsDev.cacheTtlMs,
			providerAliases: mergeProviderAliases(DEFAULT_CONFIG.modelsDev.providerAliases, input.modelsDev?.providerAliases),
		},
		heuristics: {
			defaultApi: input.heuristics?.defaultApi ?? DEFAULT_CONFIG.heuristics.defaultApi,
			providerLabelInName: input.heuristics?.providerLabelInName ?? DEFAULT_CONFIG.heuristics.providerLabelInName,
			apiRules: input.heuristics?.apiRules ?? DEFAULT_CONFIG.heuristics.apiRules,
			reasoningTokens: input.heuristics?.reasoningTokens ?? DEFAULT_CONFIG.heuristics.reasoningTokens,
			imageTokens: input.heuristics?.imageTokens ?? DEFAULT_CONFIG.heuristics.imageTokens,
			contextWindowRules: input.heuristics?.contextWindowRules ?? DEFAULT_CONFIG.heuristics.contextWindowRules,
			maxTokensRules: input.heuristics?.maxTokensRules ?? DEFAULT_CONFIG.heuristics.maxTokensRules,
		},
		modelOverrides: mergeModelOverrides(DEFAULT_CONFIG.modelOverrides, input.modelOverrides),
	};
}

export async function loadGatewayProviderConfig(pathOrUrl: string | URL): Promise<GatewayProviderConfig> {
	const raw = await readFile(pathOrUrl, "utf8");
	const parsed = JSON.parse(raw) as GatewayProviderConfigInput;
	return defineGatewayProviderConfig(parsed);
}

