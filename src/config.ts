import { readFile } from "node:fs/promises";

import type {
	ApertureProviderConfig,
	ApertureProviderConfigInput,
	ModelOverride,
} from "./types.js";

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

export const DEFAULT_CONFIG: ApertureProviderConfig = {
	providerName: "aperture-provider",
	baseUrl: "",
	apiKey: "-",
	modelsPath: "/models",
	modelsDev: {
		enabled: true,
		url: "https://models.dev/api.json",
		cacheTtlMs: 60 * 60 * 1000,
		providerAliases: DEFAULT_PROVIDER_ALIASES,
	},
	resolution: {
		requireModelsDevForCapabilities: true,
		providerLabelInName: true,
		apiRules: [
			{
				match: ["/v1/messages"],
				api: "anthropic-messages",
			},
			{
				match: ["/v1/responses"],
				api: "openai-responses",
			},
		],
	},
	modelOverrides: {},
};

function mergeProviderAliases(
	base: Record<string, string[]>,
	incoming: Record<string, string[]> | undefined
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

function mergeModelOverrides(
	base: Record<string, ModelOverride>,
	incoming: Record<string, ModelOverride> | undefined
) {
	const merged: Record<string, ModelOverride> = { ...base };
	for (const [modelId, override] of Object.entries(incoming ?? {})) {
		merged[modelId] = {
			...(merged[modelId] ?? {}),
			...override,
		};
	}
	return merged;
}

export function defineApertureProviderConfig(
	input: ApertureProviderConfigInput
): ApertureProviderConfig {
	return {
		providerName: input.providerName ?? DEFAULT_CONFIG.providerName,
		baseUrl: input.baseUrl ?? DEFAULT_CONFIG.baseUrl,
		apiKey: input.apiKey ?? DEFAULT_CONFIG.apiKey,
		modelsPath: input.modelsPath ?? DEFAULT_CONFIG.modelsPath,
		modelsDev: {
			enabled: input.modelsDev?.enabled ?? DEFAULT_CONFIG.modelsDev.enabled,
			url: input.modelsDev?.url ?? DEFAULT_CONFIG.modelsDev.url,
			cacheTtlMs: input.modelsDev?.cacheTtlMs ?? DEFAULT_CONFIG.modelsDev.cacheTtlMs,
			providerAliases: mergeProviderAliases(
				DEFAULT_CONFIG.modelsDev.providerAliases,
				input.modelsDev?.providerAliases
			),
		},
		resolution: {
			requireModelsDevForCapabilities:
				input.resolution?.requireModelsDevForCapabilities ??
				DEFAULT_CONFIG.resolution.requireModelsDevForCapabilities,
			providerLabelInName:
				input.resolution?.providerLabelInName ?? DEFAULT_CONFIG.resolution.providerLabelInName,
			apiRules: input.resolution?.apiRules ?? DEFAULT_CONFIG.resolution.apiRules,
		},
		modelOverrides: mergeModelOverrides(DEFAULT_CONFIG.modelOverrides, input.modelOverrides),
	};
}

export async function loadApertureProviderConfig(
	pathOrUrl: string | URL
): Promise<ApertureProviderConfig> {
	const raw = await readFile(pathOrUrl, "utf8");
	const parsed = JSON.parse(raw) as ApertureProviderConfigInput;
	return defineApertureProviderConfig(parsed);
}
