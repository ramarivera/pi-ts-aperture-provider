import { DEFAULT_CONFIG, defineApertureProviderConfig } from "./config";
import { buildModelsDevIndex, enrichApertureModelMetadata } from "./models-dev";
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
	NamedProviderRegistration,
	ProviderApi,
	ProviderCost,
	ProviderInput,
	ProviderModel,
} from "./types";

type ApertureCompatibility = Partial<{
	openai_chat: boolean;
	openai_responses: boolean;
	anthropic_messages: boolean;
}>;

type ApertureGatewayProviderConfig = {
	compatibility?: ApertureCompatibility;
};

type ApertureGatewayConfig = {
	providers?: Record<string, ApertureGatewayProviderConfig>;
};

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function gatewayConfigUrl(baseUrl: string): string {
	return new URL("/aperture/config", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function normalizeValue(value: string | null | undefined): string {
	return (value ?? "").toLowerCase().trim();
}

function stripLineComments(value: string): string {
	let result = "";
	let inString = false;
	let stringDelimiter = "";
	let escaped = false;

	for (let index = 0; index < value.length; index += 1) {
		const current = value[index];
		const next = value[index + 1];

		if (inString) {
			result += current;
			if (escaped) {
				escaped = false;
			} else if (current === "\\") {
				escaped = true;
			} else if (current === stringDelimiter) {
				inString = false;
				stringDelimiter = "";
			}
			continue;
		}

		if (current === '"' || current === "'") {
			inString = true;
			stringDelimiter = current;
			result += current;
			continue;
		}

		if (current === "/" && next === "/") {
			while (index < value.length && value[index] !== "\n") {
				index += 1;
			}
			if (index < value.length) {
				result += value[index];
			}
			continue;
		}

		result += current;
	}

	return result;
}

function stripTrailingCommas(value: string): string {
	let result = "";
	let inString = false;
	let stringDelimiter = "";
	let escaped = false;

	for (let index = 0; index < value.length; index += 1) {
		const current = value[index];

		if (inString) {
			result += current;
			if (escaped) {
				escaped = false;
			} else if (current === "\\") {
				escaped = true;
			} else if (current === stringDelimiter) {
				inString = false;
				stringDelimiter = "";
			}
			continue;
		}

		if (current === '"' || current === "'") {
			inString = true;
			stringDelimiter = current;
			result += current;
			continue;
		}

		if (current === ",") {
			let lookahead = index + 1;
			while (lookahead < value.length && /\s/.test(value[lookahead] ?? "")) {
				lookahead += 1;
			}
			const next = value[lookahead];
			if (next === "}" || next === "]") {
				continue;
			}
		}

		result += current;
	}

	return result;
}

function parseApertureGatewayConfig(rawConfig: string): ApertureGatewayConfig {
	return JSON.parse(stripTrailingCommas(stripLineComments(rawConfig))) as ApertureGatewayConfig;
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

function providerNameLabel(provider: ApertureProviderMetadata | undefined): string | null {
	const providerId = provider?.id?.trim();
	if (providerId) {
		return providerId;
	}

	const providerName = provider?.name?.trim();
	if (providerName) {
		return providerName;
	}

	return null;
}

function findModelOverride(modelId: string, overrides: ApertureProviderConfig["modelOverrides"]) {
	return overrides[modelId] ?? overrides[normalizeValue(modelId)];
}

function resolveApiFromCompatibility(
	compatibility: ApertureCompatibility | undefined
): ProviderApi | null {
	const matches: ProviderApi[] = [];

	if (compatibility?.anthropic_messages) {
		matches.push("anthropic-messages");
	}

	if (compatibility?.openai_responses) {
		matches.push("openai-responses");
	}

	if (compatibility?.openai_chat) {
		matches.push("openai-completions");
	}

	return matches.length === 1 ? matches[0] : null;
}

function resolveApiFromGatewayConfig(
	model: ApertureModel,
	providerApiMap: Map<string, ProviderApi>
): ProviderApi | null {
	const providerId = normalizeValue(model.metadata?.provider?.id);
	if (providerId === "") {
		return null;
	}

	return providerApiMap.get(providerId) ?? null;
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

function resolveApiForModel(
	model: ApertureModel,
	config: ApertureProviderConfig,
	providerApiMap: Map<string, ProviderApi>
): ProviderApi {
	return (
		resolveApiFromGatewayConfig(model, providerApiMap) ??
		resolveApiFromProviderMetadata(model, config)
	);
}

function dedupeModels(
	models: ApertureModel[],
	config: ApertureProviderConfig,
	providerApiMap: Map<string, ProviderApi>
): ApertureModel[] {
	const seen = new Set<string>();
	const deduped: ApertureModel[] = [];

	for (const model of models) {
		const api = resolveApiForModel(model, config, providerApiMap);
		const key = `${api}:${model.id}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(model);
	}

	return deduped;
}

const PROVIDER_API_SUFFIX: Record<ProviderApi, string> = {
	"openai-completions": "openai",
	"openai-responses": "responses",
	"anthropic-messages": "anthropic",
};

function buildProviderRegistrations(
	config: ApertureProviderConfig,
	models: ProviderModel[]
): NamedProviderRegistration[] {
	const grouped = new Map<ProviderApi, ProviderModel[]>();

	for (const model of models) {
		const existing = grouped.get(model.api) ?? [];
		existing.push(model);
		grouped.set(model.api, existing);
	}

	const entries = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
	const useSuffixes = entries.length > 1;

	return entries.map(([api, apiModels]) => ({
		name: useSuffixes ? `${config.providerName}-${PROVIDER_API_SUFFIX[api]}` : config.providerName,
		registration: {
			baseUrl: config.baseUrl,
			apiKey: config.apiKey,
			api,
			models: apiModels,
		},
	}));
}

function requireCapability<T>(
	model: ApertureModel,
	field: string,
	overrideValue: T | undefined,
	modelsDevValue: T | null,
	requireModelsDev: boolean
): T {
	if (overrideValue !== undefined) {
		return overrideValue;
	}

	if (modelsDevValue !== null) {
		return modelsDevValue;
	}

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
	modelsDevIndex: ModelsDevIndex | null,
	providerApiMap: Map<string, ProviderApi>
): ProviderModel {
	const override = findModelOverride(model.id, config.modelOverrides);
	const api = override?.api ?? resolveApiForModel(model, config, providerApiMap);
	const providerLabel = providerNameLabel(model.metadata?.provider);
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
	let apertureConfigPromise: Promise<Map<string, ProviderApi>> | null = null;
	let apertureConfigCache: Map<string, ProviderApi> | null = null;
	let lastSyncSummary = "not synced yet";
	let lastModelsDevSummary = "not fetched yet";

	async function fetchApertureModels(): Promise<ApertureModel[]> {
		const providerApiMap = await fetchProviderApiMap().catch(() => new Map<string, ProviderApi>());
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

		return dedupeModels(models, config, providerApiMap);
	}

	async function fetchProviderApiMap(): Promise<Map<string, ProviderApi>> {
		if (apertureConfigCache) {
			return apertureConfigCache;
		}

		if (apertureConfigPromise) {
			return apertureConfigPromise;
		}

		apertureConfigPromise = (async () => {
			const response = await fetch(gatewayConfigUrl(config.baseUrl), {
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				throw new Error(
					`Failed to fetch aperture config: ${response.status} ${await response.text()}`
				);
			}

			const payload = (await response.json()) as { config?: string | ApertureGatewayConfig };
			const rawConfig = payload.config;
			const parsedConfig =
				typeof rawConfig === "string" ? parseApertureGatewayConfig(rawConfig) : (rawConfig ?? {});
			const providerApiMap = new Map<string, ProviderApi>();

			for (const [providerId, providerConfig] of Object.entries(parsedConfig.providers ?? {})) {
				const api = resolveApiFromCompatibility(providerConfig.compatibility);
				if (!api) {
					continue;
				}

				providerApiMap.set(normalizeValue(providerId), api);
			}

			apertureConfigCache = providerApiMap;
			return providerApiMap;
		})().finally(() => {
			apertureConfigPromise = null;
		});

		return apertureConfigPromise;
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

		if (modelsDevIndexPromise) {
			return modelsDevIndexPromise;
		}

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
		const [providerApiMap, apertureModels, modelsDevIndex] = await Promise.all([
			fetchProviderApiMap().catch(() => new Map<string, ProviderApi>()),
			fetchApertureModels(),
			fetchModelsDevIndex(options?.forceRefreshModelsDev).catch(() => null),
		]);

		const models = apertureModels.map((model) =>
			toProviderModel(model, config, modelsDevIndex, providerApiMap)
		);
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
		const registrations = buildProviderRegistrations(config, models);

		return {
			registrations,
			summary,
			modelsDevSummary,
		};
	}

	async function sync(
		registrar: Parameters<ApertureProviderRuntime["sync"]>[0],
		ctx?: Parameters<ApertureProviderRuntime["sync"]>[1],
		options?: Parameters<ApertureProviderRuntime["sync"]>[2]
	): Promise<void> {
		if (syncPromise) {
			return syncPromise;
		}

		syncPromise = (async () => {
			const { registrations, summary } = await buildRegistration(options);
			for (const entry of registrations) {
				registrar.registerProvider(entry.name, entry.registration);
			}
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
