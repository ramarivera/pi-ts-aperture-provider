import { readFile } from "node:fs/promises";

import type { ApertureProviderConfig, ApertureProviderConfigInput, ModelOverride } from "./types";

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

function cloneRecordArrays(source: Record<string, string[]>): Record<string, string[]> {
	return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, [...value]]));
}

function mergeProviderAliases(
	base: Record<string, string[]>,
	incoming: Record<string, string[]> | undefined
): Record<string, string[]> {
	const merged = cloneRecordArrays(base);
	for (const [key, value] of Object.entries(incoming ?? {})) {
		const existing = new Set(merged[key] ?? []);
		for (const alias of value) {
			existing.add(alias);
		}
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

function resolveModelsDevConfig(
	input: ApertureProviderConfigInput["modelsDev"] | undefined
): ApertureProviderConfig["modelsDev"] {
	const defaults = DEFAULT_CONFIG.modelsDev;

	return {
		enabled: input?.enabled ?? defaults.enabled,
		url: input?.url ?? defaults.url,
		cacheTtlMs: input?.cacheTtlMs ?? defaults.cacheTtlMs,
		providerAliases: mergeProviderAliases(defaults.providerAliases, input?.providerAliases),
	};
}

function resolveResolutionConfig(
	input: ApertureProviderConfigInput["resolution"] | undefined
): ApertureProviderConfig["resolution"] {
	const defaults = DEFAULT_CONFIG.resolution;

	return {
		requireModelsDevForCapabilities:
			input?.requireModelsDevForCapabilities ?? defaults.requireModelsDevForCapabilities,
		providerLabelInName: input?.providerLabelInName ?? defaults.providerLabelInName,
		apiRules: input?.apiRules ?? defaults.apiRules,
	};
}

export function defineApertureProviderConfig(
	input: ApertureProviderConfigInput
): ApertureProviderConfig {
	return {
		providerName: input.providerName ?? DEFAULT_CONFIG.providerName,
		baseUrl: input.baseUrl ?? DEFAULT_CONFIG.baseUrl,
		apiKey: input.apiKey ?? DEFAULT_CONFIG.apiKey,
		modelsPath: input.modelsPath ?? DEFAULT_CONFIG.modelsPath,
		modelsDev: resolveModelsDevConfig(input.modelsDev),
		resolution: resolveResolutionConfig(input.resolution),
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
