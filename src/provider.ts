import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, defineApertureProviderConfig } from "./config";
import { resolveFallbackMetadata } from "./fallback-metadata";
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
	ProviderRegistrar,
	ProviderRegistration,
	SyncContext,
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

type CachedProviderRegistration = Omit<ProviderRegistration, "apiKey">;

type CachedNamedProviderRegistration = {
	name: string;
	registration: CachedProviderRegistration;
};

type CachedBuildRegistrationResult = Omit<BuildRegistrationResult, "registrations"> & {
	registrations: CachedNamedProviderRegistration[];
};

type PersistedRegistrationCache = {
	version: 1;
	configHash: string;
	result: CachedBuildRegistrationResult;
	cachedAt: number;
};

type CreateApertureProviderRuntimeOptions = {
	cachePath?: string;
	debug?: boolean;
};

const CACHE_VERSION = 1;
const YELLOW = "\u001b[33m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

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

function registrationBaseUrl(baseUrl: string, api: ProviderApi): string {
	if (api !== "anthropic-messages") {
		return baseUrl;
	}

	return baseUrl.replace(/\/v1\/?$/, "");
}

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
			baseUrl: registrationBaseUrl(config.baseUrl, api),
			apiKey: config.apiKey,
			api,
			models: apiModels,
		},
	}));
}

type CapabilitySource = "override" | "models.dev" | "fallback";

type ResolvedCapability<T> = {
	value: T;
	source: CapabilitySource;
};

function missingCapabilityError(
	model: ApertureModel,
	field: string,
	requireModelsDev: boolean
): Error {
	if (requireModelsDev) {
		return new Error(
			`Missing required "${field}" metadata for model "${model.id}". Add a model override or ensure models.dev has this model.`
		);
	}

	return new Error(
		`Model "${model.id}" cannot be registered without "${field}" metadata. Add a model override for this model.`
	);
}

function isMissingCapabilityError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return (
		error.message.includes('Missing required "') ||
		error.message.includes("cannot be registered without")
	);
}

function resolveCapability<T>(
	model: ApertureModel,
	field: string,
	overrideValue: T | undefined,
	modelsDevValue: T | null,
	fallbackValue: T | undefined,
	requireModelsDev: boolean
): ResolvedCapability<T> {
	if (overrideValue !== undefined) {
		return { value: overrideValue, source: "override" };
	}

	if (modelsDevValue !== null) {
		return { value: modelsDevValue, source: "models.dev" };
	}

	if (fallbackValue !== undefined) {
		return { value: fallbackValue, source: "fallback" };
	}

	throw missingCapabilityError(model, field, requireModelsDev);
}

function toProviderModel(
	model: ApertureModel,
	config: ApertureProviderConfig,
	modelsDevIndex: ModelsDevIndex | null,
	providerApiMap: Map<string, ProviderApi>
): { model: ProviderModel; warnings: string[] } {
	const override = findModelOverride(model.id, config.modelOverrides);
	const api = override?.api ?? resolveApiForModel(model, config, providerApiMap);
	const providerLabel = providerNameLabel(model.metadata?.provider);
	const compat = override?.compat ?? inferCompat(api);
	const enriched = enrichApertureModelMetadata(model, modelsDevIndex);
	const fallback = config.resolution.useKnownModelFallbacks
		? resolveFallbackMetadata(model, config.fallbackMetadata)
		: null;
	const fallbackFields: string[] = [];
	const reasoning = resolveCapability(
		model,
		"reasoning",
		override?.reasoning,
		enriched.reasoning,
		fallback?.reasoning,
		config.resolution.requireModelsDevForCapabilities
	);
	if (reasoning.source === "fallback") {
		fallbackFields.push("reasoning");
	}
	const input = resolveCapability<ProviderInput[]>(
		model,
		"input",
		override?.input,
		enriched.input,
		fallback?.input,
		config.resolution.requireModelsDevForCapabilities
	);
	if (input.source === "fallback") {
		fallbackFields.push("input");
	}
	const contextWindow = resolveCapability(
		model,
		"contextWindow",
		override?.contextWindow,
		enriched.contextWindow,
		fallback?.contextWindow,
		config.resolution.requireModelsDevForCapabilities
	);
	if (contextWindow.source === "fallback") {
		fallbackFields.push("contextWindow");
	}
	const maxTokens = resolveCapability(
		model,
		"maxTokens",
		override?.maxTokens,
		enriched.maxTokens,
		fallback?.maxTokens,
		config.resolution.requireModelsDevForCapabilities
	);
	if (maxTokens.source === "fallback") {
		fallbackFields.push("maxTokens");
	}
	const cost = hasAperturePricing(model) ? inferCost(model) : (enriched.cost ?? inferCost(model));
	const warnings =
		fallbackFields.length > 0
			? [`Using fallback metadata for model "${model.id}": ${fallbackFields.join(", ")}.`]
			: [];

	return {
		model: {
			id: model.id,
			name:
				override?.name ??
				(config.resolution.providerLabelInName && providerLabel
					? `${model.id} (${providerLabel})`
					: model.id),
			api,
			reasoning: reasoning.value,
			input: input.value,
			cost: override?.cost ?? cost,
			contextWindow: contextWindow.value,
			maxTokens: maxTokens.value,
			...(compat ? { compat } : {}),
		},
		warnings,
	};
}

function sanitizeCacheSegment(value: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return sanitized || "aperture-provider";
}

function defaultCachePath(config: ApertureProviderConfig): string {
	return join(
		homedir(),
		".pi",
		"agent",
		"cache",
		"aperture-provider",
		`${sanitizeCacheSegment(config.providerName)}.json`
	);
}

function configCacheHash(config: ApertureProviderConfig): string {
	return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function emitFormattedWarning(message: string) {
	console.warn(`${YELLOW}Aperture warning${RESET} ${DIM}${message}${RESET}`);
}

function emitDebugError(message: string, error: unknown) {
	console.error(`${YELLOW}Aperture debug${RESET} ${message}`);
	console.error(error);
}

function toCachedBuildRegistrationResult(
	result: BuildRegistrationResult
): CachedBuildRegistrationResult {
	return {
		...result,
		registrations: result.registrations.map((entry) => ({
			name: entry.name,
			registration: {
				baseUrl: entry.registration.baseUrl,
				api: entry.registration.api,
				models: entry.registration.models,
			},
		})),
	};
}

function fromCachedBuildRegistrationResult(
	result: CachedBuildRegistrationResult,
	apiKey: string
): BuildRegistrationResult {
	return {
		...result,
		registrations: result.registrations.map((entry) => ({
			name: entry.name,
			registration: {
				...entry.registration,
				apiKey,
			},
		})),
	};
}

export function createApertureProviderRuntime(
	input: ApertureProviderConfigInput,
	options?: CreateApertureProviderRuntimeOptions
): ApertureProviderRuntime {
	const config = defineApertureProviderConfig({
		...DEFAULT_CONFIG,
		...input,
	});
	const debug =
		options?.debug ??
		(process.env.PI_APERTURE_DEBUG === "1" || process.env.PI_APERTURE_DEBUG === "true");
	const cachePath = options?.cachePath ?? defaultCachePath(config);
	const cacheHash = configCacheHash(config);
	let syncPromise: Promise<void> | null = null;
	let backgroundRefreshPromise: Promise<void> | null = null;
	let modelsDevIndexPromise: Promise<ModelsDevIndex> | null = null;
	let modelsDevIndexCache: ModelsDevIndex | null = null;
	let modelsDevIndexCachedAt = 0;
	let apertureConfigPromise: Promise<Map<string, ProviderApi>> | null = null;
	let apertureConfigCache: Map<string, ProviderApi> | null = null;
	let lastSyncSummary = "not synced yet";
	let lastModelsDevSummary = "not fetched yet";
	let lastWarnings: string[] = [];

	async function readRegistrationCache(): Promise<BuildRegistrationResult | null> {
		try {
			const raw = await readFile(cachePath, "utf8");
			const parsed = JSON.parse(raw) as PersistedRegistrationCache;
			if (parsed.version !== CACHE_VERSION) {
				return null;
			}
			if (parsed.configHash !== cacheHash) {
				return null;
			}
			if (!parsed.result || !Array.isArray(parsed.result.registrations)) {
				return null;
			}
			return fromCachedBuildRegistrationResult(parsed.result, config.apiKey);
		} catch {
			return null;
		}
	}

	async function writeRegistrationCache(result: BuildRegistrationResult): Promise<void> {
		try {
			await mkdir(dirname(cachePath), { recursive: true });
			await writeFile(
				cachePath,
				JSON.stringify(
					{
						version: CACHE_VERSION,
						configHash: cacheHash,
						result: toCachedBuildRegistrationResult(result),
						cachedAt: Date.now(),
					} satisfies PersistedRegistrationCache,
					null,
					2
				),
				"utf8"
			);
		} catch (error) {
			if (debug) {
				emitDebugError(`failed to write Aperture cache at ${cachePath}`, error);
			}
		}
	}

	function registerFromResult(registrar: ProviderRegistrar, result: BuildRegistrationResult) {
		for (const entry of result.registrations) {
			registrar.registerProvider(entry.name, entry.registration);
		}
	}

	function emitWarnings(warnings: string[]) {
		if (!debug) {
			return;
		}

		for (const warning of warnings) {
			emitFormattedWarning(warning);
		}
	}

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

	async function buildRegistrationFresh(options?: {
		forceRefreshModelsDev?: boolean;
	}): Promise<BuildRegistrationResult> {
		const [providerApiMap, apertureModels, modelsDevIndex] = await Promise.all([
			fetchProviderApiMap().catch(() => new Map<string, ProviderApi>()),
			fetchApertureModels(),
			fetchModelsDevIndex(options?.forceRefreshModelsDev).catch(() => null),
		]);

		const models: ProviderModel[] = [];
		const warnings: string[] = [];
		let skippedModels = 0;
		for (const model of apertureModels) {
			try {
				const resolved = toProviderModel(model, config, modelsDevIndex, providerApiMap);
				models.push(resolved.model);
				warnings.push(...resolved.warnings);
			} catch (error) {
				if (!config.resolution.skipModelsMissingCapabilities || !isMissingCapabilityError(error)) {
					throw error;
				}

				skippedModels += 1;
				warnings.push(
					`Skipping model "${model.id}" because capability metadata is incomplete: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}

		emitWarnings(warnings);

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
		const apiSummary =
			Object.entries(apiCounts)
				.map(([api, count]) => `${count} ${api}`)
				.join(", ") || "no registrations";
		const summaryParts = [modelsDevSummary];
		if (skippedModels > 0) {
			summaryParts.push(`${skippedModels} skipped`);
		}
		if (warnings.length > 0) {
			summaryParts.push(`${warnings.length} warnings`);
		}
		const summary = `${models.length} models (${apiSummary}; ${summaryParts.join("; ")})`;
		const registrations = buildProviderRegistrations(config, models);
		return {
			registrations,
			summary,
			modelsDevSummary,
			warnings,
		};
	}

	async function scheduleBackgroundRefresh(_ctx?: SyncContext): Promise<void> {
		if (backgroundRefreshPromise) {
			return backgroundRefreshPromise;
		}

		backgroundRefreshPromise = (async () => {
			try {
				const result = await buildRegistrationFresh();
				await writeRegistrationCache(result);
			} catch (error) {
				if (debug) {
					emitDebugError("background Aperture refresh failed", error);
				}
			}
		})().finally(() => {
			backgroundRefreshPromise = null;
		});

		return backgroundRefreshPromise;
	}

	async function buildRegistration(options?: {
		forceRefreshModelsDev?: boolean;
	}): Promise<BuildRegistrationResult> {
		return buildRegistrationFresh({
			forceRefreshModelsDev: options?.forceRefreshModelsDev,
		});
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
			const forceRefresh = options?.forceRefreshModelsDev === true;
			if (!forceRefresh) {
				const cached = await readRegistrationCache();
				if (cached) {
					registerFromResult(registrar, cached);
					lastSyncSummary = `${cached.summary} [cache]`;
					lastWarnings = cached.warnings;
					void scheduleBackgroundRefresh(ctx);
					return;
				}
			}

			const result = await buildRegistrationFresh({
				forceRefreshModelsDev: forceRefresh,
			});
			await writeRegistrationCache(result);
			registerFromResult(registrar, result);
			lastSyncSummary = result.summary;
			lastWarnings = result.warnings;
			ctx?.ui?.notify(`${config.providerName} synced: ${result.summary}`, "success");
		})()
			.catch((error) => {
				lastSyncSummary = error instanceof Error ? error.message : String(error);
				lastWarnings = [];
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
				lastWarnings,
			};
		},
		getConfig() {
			return config;
		},
	};
}
