import type {
	ApertureModel,
	ApertureProviderConfig,
	ModelOverride,
	ProviderApi,
	ProviderCompat,
	ProviderCost,
	ProviderInput,
} from "./types.js";

function normalizeValue(value: string | null | undefined): string {
	return (value ?? "").toLowerCase().trim();
}

function includesAny(haystack: string, values: string[]): boolean {
	return values.some((value) => haystack.includes(normalizeValue(value)));
}

function findNumericRule(
	modelId: string,
	rules: ApertureProviderConfig["heuristics"]["contextWindowRules"]
): number | null {
	const id = normalizeValue(modelId);
	for (const rule of rules) {
		if (includesAny(id, rule.match)) {
			return rule.value;
		}
	}
	return null;
}

export function inferApi(model: ApertureModel, config: ApertureProviderConfig): ProviderApi {
	const providerId = normalizeValue(model.metadata?.provider?.id);
	const providerDescription = normalizeValue(model.metadata?.provider?.description);
	const providerName = normalizeValue(model.metadata?.provider?.name);
	const haystack = `${providerId} ${providerDescription} ${providerName}`;

	for (const rule of config.heuristics.apiRules) {
		if (includesAny(haystack, rule.match)) {
			return rule.api;
		}
	}

	return config.heuristics.defaultApi;
}

export function inferReasoning(modelId: string, config: ApertureProviderConfig): boolean {
	return includesAny(modelId, config.heuristics.reasoningTokens);
}

export function inferInput(modelId: string, config: ApertureProviderConfig): ProviderInput[] {
	const id = normalizeValue(modelId);
	if (includesAny(id, config.heuristics.imageTokens) || id.endsWith("v")) {
		return ["text", "image"];
	}
	return ["text"];
}

export function inferContextWindow(modelId: string, config: ApertureProviderConfig): number {
	return findNumericRule(modelId, config.heuristics.contextWindowRules) ?? 128000;
}

export function inferMaxTokens(modelId: string, config: ApertureProviderConfig): number {
	return findNumericRule(modelId, config.heuristics.maxTokensRules) ?? 32768;
}

export function inferCost(model: ApertureModel): ProviderCost {
	const pricing = model.pricing ?? {};
	return {
		input: Number(pricing.input ?? 0) * 1_000_000,
		output: Number(pricing.output ?? 0) * 1_000_000,
		cacheRead: Number(pricing.input_cache_read ?? 0) * 1_000_000,
		cacheWrite: Number(pricing.input_cache_write ?? 0) * 1_000_000,
	};
}

export function hasAperturePricing(model: ApertureModel): boolean {
	const pricing = model.pricing;
	return pricing != null && Object.keys(pricing).length > 0;
}

export function dedupeModels(
	models: ApertureModel[],
	config: ApertureProviderConfig
): ApertureModel[] {
	const seen = new Set<string>();
	const deduped: ApertureModel[] = [];

	for (const model of models) {
		const api = inferApi(model, config);
		const key = `${api}:${model.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(model);
	}

	return deduped;
}

export function inferCompat(api: ProviderApi): ProviderCompat | undefined {
	if (api === "openai-completions" || api === "openai-responses") {
		return {
			supportsDeveloperRole: false,
		};
	}
	return undefined;
}

export function findModelOverride(
	modelId: string,
	overrides: Record<string, ModelOverride>
): ModelOverride | undefined {
	return overrides[modelId] ?? overrides[normalizeValue(modelId)];
}
