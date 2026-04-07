import type {
	GatewayModel,
	GatewayModelEnrichment,
	IndexedModelsDevModel,
	ModelsDevApiResponse,
	ModelsDevIndex,
	ModelsDevModel,
	ProviderCost,
	ProviderInput,
} from "./types.js";

function normalizeValue(value: string | null | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.trim()
		.replace(/[_\s/]+/g, "-")
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function appendUnique(target: string[], values: (string | null | undefined)[]) {
	for (const value of values) {
		const normalized = normalizeValue(value);
		if (normalized !== "" && !target.includes(normalized)) {
			target.push(normalized);
		}
	}
}

function providerHints(model: GatewayModel): string[] {
	const providerId = model.metadata?.provider?.id;
	const providerName = model.metadata?.provider?.name;
	const providerDescription = model.metadata?.provider?.description;
	const hints: string[] = [];

	appendUnique(hints, [providerId, providerName, providerDescription]);

	const haystack = [
		normalizeValue(providerId),
		normalizeValue(providerName),
		normalizeValue(providerDescription),
	].join(" ");

	if (haystack.includes("opencode-zen-black")) appendUnique(hints, ["opencode"]);
	if (haystack.includes("anthropic")) appendUnique(hints, ["anthropic"]);
	if (haystack.includes("openai")) appendUnique(hints, ["openai", "openai-responses"]);
	if (haystack.includes("minimax")) appendUnique(hints, ["minimax"]);
	if (haystack.includes("alibaba")) appendUnique(hints, ["alibaba", "qwen"]);
	if (haystack.includes("z-ai") || haystack.includes("zai") || haystack.includes("glm") || haystack.includes("zhipu")) {
		appendUnique(hints, ["zai"]);
	}

	return hints;
}

function preferredProviderIds(model: GatewayModel, index: ModelsDevIndex): string[] {
	const providerIds: string[] = [];

	for (const hint of providerHints(model)) {
		appendUnique(providerIds, [hint]);
		for (const alias of index.providerAliases.get(hint) ?? []) {
			appendUnique(providerIds, [alias]);
		}
	}

	return providerIds;
}

function normalizeModelKeys(model: GatewayModel): string[] {
	const normalizedId = normalizeValue(model.id);
	const variants = new Set<string>();

	const add = (value: string) => {
		if (value !== "") variants.add(value);
	};

	add(normalizedId);
	add(normalizedId.replace(/\.(\d+)/g, "-$1"));
	add(normalizedId.replace(/-(\d+)/g, ".$1"));
	add(normalizedId.replace(/([a-z])-(\d)/g, "$1.$2"));
	add(normalizedId.replace(/([a-z])(\d)/g, "$1-$2"));
	add(normalizedId.replace(/([a-z])(\d)/g, "$1.$2"));
	add(normalizedId.replace(/-highspeed$/, ""));
	add(normalizedId.replace(/-latest$/, ""));
	add(normalizedId.replace(/-thinking$/, ""));

	return [...variants];
}

function insertMultiValue(map: Map<string, IndexedModelsDevModel[]>, key: string, value: IndexedModelsDevModel) {
	const existing = map.get(key) ?? [];
	existing.push(value);
	map.set(key, existing);
}

export function buildModelsDevIndex(
	catalog: ModelsDevApiResponse,
	providerAliasConfig: Record<string, string[]>,
): ModelsDevIndex {
	const providers = new Map();
	const providerAliases = new Map<string, string[]>();
	const modelsByProviderAndId = new Map<string, IndexedModelsDevModel>();
	const modelsById = new Map<string, IndexedModelsDevModel[]>();
	const modelsByName = new Map<string, IndexedModelsDevModel[]>();

	for (const [providerKey, providerCatalog] of Object.entries(catalog)) {
		const providerId = normalizeValue(providerCatalog.id ?? providerKey);
		const providerName = providerCatalog.name?.trim() ?? providerId;

		providers.set(providerId, providerCatalog);

		const aliases = new Set<string>([
			providerId,
			normalizeValue(providerCatalog.name),
			...(providerAliasConfig[providerId] ?? []),
		]);

		for (const alias of aliases) {
			if (alias === "") continue;
			const existing = new Set(providerAliases.get(alias) ?? []);
			existing.add(providerId);
			providerAliases.set(alias, [...existing]);
		}

		for (const [modelKey, model] of Object.entries(providerCatalog.models ?? {})) {
			const entry: IndexedModelsDevModel = {
				providerId,
				providerName,
				modelKey,
				model,
			};

			for (const key of new Set([normalizeValue(modelKey), normalizeValue(model.id)])) {
				if (key === "") continue;
				modelsByProviderAndId.set(`${providerId}:${key}`, entry);
				insertMultiValue(modelsById, key, entry);
			}

			const normalizedName = normalizeValue(model.name);
			if (normalizedName !== "") {
				insertMultiValue(modelsByName, normalizedName, entry);
			}
		}
	}

	return {
		providers,
		providerAliases,
		modelsByProviderAndId,
		modelsById,
		modelsByName,
	};
}

function toProviderInputModalities(model: ModelsDevModel): ProviderInput[] | null {
	const rawInput = model.modalities?.input ?? [];
	if (!Array.isArray(rawInput) || rawInput.length === 0) {
		return null;
	}

	const normalized = rawInput.map((value) => normalizeValue(value));
	const input: ProviderInput[] = [];
	if (normalized.includes("text")) input.push("text");
	if (normalized.includes("image")) input.push("image");

	if (input.length === 0 && normalized.length > 0) {
		input.push("text");
	}

	return input;
}

function toProviderCost(model: ModelsDevModel): ProviderCost | null {
	const cost = model.cost;
	if (!cost) return null;

	return {
		input: Number(cost.input ?? 0) * 1_000_000,
		output: Number(cost.output ?? 0) * 1_000_000,
		cacheRead: Number(cost.cache_read ?? 0) * 1_000_000,
		cacheWrite: Number(cost.cache_write ?? 0) * 1_000_000,
	};
}

function findProviderScopedMatch(model: GatewayModel, index: ModelsDevIndex): IndexedModelsDevModel | null {
	const modelKeys = normalizeModelKeys(model);
	for (const providerId of preferredProviderIds(model, index)) {
		for (const modelKey of modelKeys) {
			const match = index.modelsByProviderAndId.get(`${providerId}:${modelKey}`);
			if (match) return match;
		}
	}

	return null;
}

function findGlobalMatch(model: GatewayModel, index: ModelsDevIndex): IndexedModelsDevModel | null {
	for (const modelKey of normalizeModelKeys(model)) {
		const byId = index.modelsById.get(modelKey);
		if (byId && byId.length > 0) return byId[0];
	}

	for (const modelKey of normalizeModelKeys(model)) {
		const byName = index.modelsByName.get(modelKey);
		if (byName && byName.length > 0) return byName[0];
	}

	return null;
}

export function enrichGatewayModelMetadata(model: GatewayModel, index: ModelsDevIndex | null): GatewayModelEnrichment {
	if (!index) {
		return {
			match: null,
			reasoning: null,
			input: null,
			contextWindow: null,
			maxTokens: null,
			cost: null,
		};
	}

	const match = findProviderScopedMatch(model, index) ?? findGlobalMatch(model, index);
	if (!match) {
		return {
			match: null,
			reasoning: null,
			input: null,
			contextWindow: null,
			maxTokens: null,
			cost: null,
		};
	}

	return {
		match,
		reasoning: typeof match.model.reasoning === "boolean" ? match.model.reasoning : null,
		input: toProviderInputModalities(match.model),
		contextWindow: match.model.limit?.context ?? null,
		maxTokens: match.model.limit?.output ?? null,
		cost: toProviderCost(match.model),
	};
}

