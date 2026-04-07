import { DEFAULT_CONFIG, defineApertureProviderConfig } from "./config.js";
import { buildModelsDevIndex, enrichApertureModelMetadata } from "./models-dev.js";
import type {
	ApertureModel,
	ApertureModelsResponse,
	ApertureProviderConfig,
	ApertureProviderConfigInput,
	ApertureProviderMetadata,
	ApertureProviderRuntime,
	BuildRegistrationResult,
	ModelsDevApiResponse,
	ModelsDevIndex,
	ProviderApi,
	ProviderCost,
	ProviderInput,
	ProviderModel,
} from "./types.js";

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function normalizeValue(value: string | null | undefined): string {
	return (value ?? "").toLowerCase().trim();
}

function inferCost(model: ApertureModel): ProviderCost {
	const pricing = model.pricing ?? {};
	return {
		input: Number(pricing.input ?? 0) * 1_000_000,
		output: Number(pricing.output ?? 0) * 1_000_000,
		cacheRead: Number(pricing.input_cache_read ?? 0) * 1_000_000,
		cacheWrite: Number(pricing.input_cache_write ?? 0) * 1_000_000,
	};
}

function hasAperturePricing(model: ApertureModel): boolean {
	const pricing = model.pricing;
	return pricing != null && Object.keys(pricing).length > 0;
}

function inferCompat(api: ProviderApi) {
	if (api === "openai-completions" || api === "openai-responses") {
		return {
			supportsDeveloperRole: false,
		};
	}

	return undefined;
}

function providerHaystack(provider: ApertureProviderMetadata | undefined): string {
	return [provider?.id, provider?.name, provider?.description].map(normalizeValue).join(" ");
}

function findModelOverride(modelId: string, overrides: ApertureProviderConfig["modelOverrides"]) {
	return overrides[modelId] ?? overrides[normalizeValue(modelId)];
}

function resolveApiFromProviderMetadata(
	model: ApertureModel,
	config: ApertureProviderConfig
): ProviderApi {
	const haystack = providerHaystack(model.metadata?.provider);

	for (const rule of config.resolution.apiRules) {
		if (rule.match.some((token) => haystack.includes(normalizeValue(token)))) {
			return rule.api;
		}
	}

	if (haystack.includes("/v1/chat/completions")) {
		return "openai-completions";
	}

	throw new Error(
		`Could not resolve API type for model "${model.id}" from provider metadata: ${JSON.stringify(model.metadata?.provider ?? {})}`
	);
}

function dedupeModels(models: ApertureModel[], config: ApertureProviderConfig): ApertureModel[] {
	const seen = new Set<string>();
	const deduped: ApertureModel[] = [];

	for (const model of models) {
		const api = resolveApiFromProviderMetadata(model, config);
		const key = `${api}:${model.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(model);
	}

	return deduped;
}

function requireCapability<T>(
	model: ApertureModel,
	field: string,
	overrideValue: T | undefined,
	modelsDevValue: T | null,
	requireModelsDev: boolean
): T {
	if (overrideValue !== undefined) return overrideValue;
	if (modelsDevValue !== null) return modelsDevValue;

	if (requireModelsDev) {
		throw new Error(
			`Missing required "${field}" metadata for model "${model.id}". Add a model override or ensure models.dev has this model.`
		);
	}

	throw new Error(
		`Model "${model.id}" cannot be registered without "${field}" metadata. Add a model override for this model.`
	);
}

function toProviderModel(
	model: ApertureModel,
	config: ApertureProviderConfig,
	modelsDevIndex: ModelsDevIndex | null
): ProviderModel {
	const override = findModelOverride(model.id, config.modelOverrides);
	const api = override?.api ?? resolveApiFromProviderMetadata(model, config);
	const providerLabel = model.metadata?.provider?.name?.trim();
	const compat = override?.compat ?? inferCompat(api);
	const enriched = enrichApertureModelMetadata(model, modelsDevIndex);
	const cost = hasAperturePricing(model) ? inferCost(model) : (enriched.cost ?? inferCost(model));

	return {
		id: model.id,
		name:
			override?.name ??
			(config.resolution.providerLabelInName && providerLabel
				? `${model.id} (${providerLabel})`
				: model.id),
		api,
		reasoning: requireCapability(
			model,
			"reasoning",
			override?.reasoning,
			enriched.reasoning,
			config.resolution.requireModelsDevForCapabilities
		),
		input: requireCapability<ProviderInput[]>(
			model,
			"input",
			override?.input,
			enriched.input,
			config.resolution.requireModelsDevForCapabilities
		),
		cost: override?.cost ?? cost,
		contextWindow: requireCapability(
			model,
			"contextWindow",
			override?.contextWindow,
			enriched.contextWindow,
			config.resolution.requireModelsDevForCapabilities
		),
		maxTokens: requireCapability(
			model,
			"maxTokens",
			override?.maxTokens,
			enriched.maxTokens,
			config.resolution.requireModelsDevForCapabilities
		),
		...(compat ? { compat } : {}),
	};
}

export function createApertureProviderRuntime(
	input: ApertureProviderConfigInput
): ApertureProviderRuntime {
	const config = defineApertureProviderConfig({
		...DEFAULT_CONFIG,
		...input,
	});
	let syncPromise: Promise<void> | null = null;
	let modelsDevIndexPromise: Promise<ModelsDevIndex> | null = null;
	let modelsDevIndexCache: ModelsDevIndex | null = null;
	let modelsDevIndexCachedAt = 0;
	let lastSyncSummary = "not synced yet";
	let lastModelsDevSummary = "not fetched yet";

	async function fetchApertureModels(): Promise<ApertureModel[]> {
		const response = await fetch(joinUrl(config.baseUrl, config.modelsPath), {
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Failed to fetch aperture models: ${response.status} ${await response.text()}`
			);
		}

		const payload = (await response.json()) as ApertureModelsResponse;
		const models = payload.data ?? [];
		if (!Array.isArray(models) || models.length === 0) {
			throw new Error("Aperture provider returned no models");
		}

		return dedupeModels(models, config);
	}

	async function fetchModelsDevIndex(forceRefresh = false): Promise<ModelsDevIndex> {
		if (!config.modelsDev.enabled) {
			lastModelsDevSummary = "disabled by config";
			throw new Error(lastModelsDevSummary);
		}

		const now = Date.now();
		if (
			!forceRefresh &&
			modelsDevIndexCache &&
			now - modelsDevIndexCachedAt < config.modelsDev.cacheTtlMs
		) {
			return modelsDevIndexCache;
		}

		if (modelsDevIndexPromise) return modelsDevIndexPromise;

		modelsDevIndexPromise = (async () => {
			const response = await fetch(config.modelsDev.url, {
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				throw new Error(
					`Failed to fetch models.dev catalog: ${response.status} ${await response.text()}`
				);
			}

			const payload = (await response.json()) as ModelsDevApiResponse;
			const index = buildModelsDevIndex(payload, config.modelsDev.providerAliases);
			modelsDevIndexCache = index;
			modelsDevIndexCachedAt = Date.now();
			lastModelsDevSummary = `${Object.keys(payload).length} providers cached`;
			return index;
		})()
			.catch((error) => {
				lastModelsDevSummary = error instanceof Error ? error.message : String(error);
				throw error;
			})
			.finally(() => {
				modelsDevIndexPromise = null;
			});

		return modelsDevIndexPromise;
	}

	async function buildRegistration(options?: {
		forceRefreshModelsDev?: boolean;
	}): Promise<BuildRegistrationResult> {
		const [apertureModels, modelsDevIndex] = await Promise.all([
			fetchApertureModels(),
			fetchModelsDevIndex(options?.forceRefreshModelsDev).catch(() => null),
		]);

		const models = apertureModels.map((model) => toProviderModel(model, config, modelsDevIndex));
		const modelsDevMatches = modelsDevIndex
			? apertureModels.filter(
					(model) => enrichApertureModelMetadata(model, modelsDevIndex).match != null
				).length
			: 0;

		const apiCounts = models.reduce<Record<string, number>>((acc, model) => {
			acc[model.api] = (acc[model.api] ?? 0) + 1;
			return acc;
		}, {});

		const modelsDevSummary =
			modelsDevIndex == null
				? `models.dev unavailable (${lastModelsDevSummary})`
				: `${modelsDevMatches}/${apertureModels.length} enriched via models.dev`;

		const summary = `${models.length} models (${Object.entries(apiCounts)
			.map(([api, count]) => `${count} ${api}`)
			.join(", ")}; ${modelsDevSummary})`;

		return {
			registration: {
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				api: "openai-completions",
				models,
			},
			summary,
			modelsDevSummary,
		};
	}

	async function sync(
		registrar: Parameters<ApertureProviderRuntime["sync"]>[0],
		ctx?: Parameters<ApertureProviderRuntime["sync"]>[1],
		options?: Parameters<ApertureProviderRuntime["sync"]>[2]
	): Promise<void> {
		if (syncPromise) return syncPromise;

		syncPromise = (async () => {
			const { registration, summary } = await buildRegistration(options);
			registrar.registerProvider(config.providerName, registration);
			lastSyncSummary = summary;
			ctx?.ui?.notify(`${config.providerName} synced: ${summary}`, "success");
		})()
			.catch((error) => {
				lastSyncSummary = error instanceof Error ? error.message : String(error);
				ctx?.ui?.notify(`${config.providerName} sync failed: ${lastSyncSummary}`, "error");
				throw error;
			})
			.finally(() => {
				syncPromise = null;
			});

		return syncPromise;
	}

	return {
		sync,
		buildRegistration,
		fetchApertureModels,
		fetchModelsDevIndex,
		getState() {
			return {
				lastSyncSummary,
				lastModelsDevSummary,
			};
		},
		getConfig() {
			return config;
		},
	};
}
