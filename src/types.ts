export type ProviderApi = "openai-completions" | "openai-responses" | "anthropic-messages";

export type ProviderInput = "text" | "image";

export type ApertureProviderMetadata = {
	id?: string;
	name?: string;
	description?: string;
};

export type ApertureModel = {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
	metadata?: {
		provider?: ApertureProviderMetadata;
	};
	pricing?: Record<string, string>;
};

export type ApertureModelsResponse = {
	object?: string;
	data?: ApertureModel[];
};

export type ProviderCost = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type ProviderCompat = {
	supportsDeveloperRole?: boolean;
};

export type ProviderModel = {
	id: string;
	name: string;
	api: ProviderApi;
	reasoning: boolean;
	input: ProviderInput[];
	cost: ProviderCost;
	contextWindow: number;
	maxTokens: number;
	compat?: ProviderCompat;
};

export type ProviderRegistration = {
	baseUrl: string;
	apiKey: string;
	api: ProviderApi;
	models: ProviderModel[];
};

export type NamedProviderRegistration = {
	name: string;
	registration: ProviderRegistration;
};

export type ProviderRegistrar = {
	registerProvider(name: string, registration: ProviderRegistration): void;
};

export type SyncContext = {
	ui?: {
		notify(message: string, kind: "success" | "error"): void;
	};
};

export type ModelsDevModel = {
	id?: string;
	name?: string;
	reasoning?: boolean;
	modalities?: {
		input?: string[];
		output?: string[];
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	limit?: {
		context?: number;
		output?: number;
	};
};

export type ModelsDevProviderCatalog = {
	id?: string;
	name?: string;
	models?: Record<string, ModelsDevModel>;
};

export type ModelsDevApiResponse = Record<string, ModelsDevProviderCatalog>;

export type IndexedModelsDevModel = {
	providerId: string;
	providerName: string;
	modelKey: string;
	model: ModelsDevModel;
};

export type ModelsDevIndex = {
	providers: Map<string, ModelsDevProviderCatalog>;
	providerAliases: Map<string, string[]>;
	modelsByProviderAndId: Map<string, IndexedModelsDevModel>;
	modelsById: Map<string, IndexedModelsDevModel[]>;
	modelsByName: Map<string, IndexedModelsDevModel[]>;
};

export type ApertureModelEnrichment = {
	match: IndexedModelsDevModel | null;
	reasoning: boolean | null;
	input: ProviderInput[] | null;
	contextWindow: number | null;
	maxTokens: number | null;
	cost: ProviderCost | null;
};

export type ApiRule = {
	match: string[];
	api: ProviderApi;
};

export type ModelOverride = Partial<{
	name: string;
	api: ProviderApi;
	reasoning: boolean;
	input: ProviderInput[];
	cost: ProviderCost;
	contextWindow: number;
	maxTokens: number;
	compat: ProviderCompat;
}>;

export type ApertureProviderConfig = {
	providerName: string;
	baseUrl: string;
	apiKey: string;
	modelsPath: string;
	modelsDev: {
		enabled: boolean;
		url: string;
		cacheTtlMs: number;
		providerAliases: Record<string, string[]>;
	};
	resolution: {
		requireModelsDevForCapabilities: boolean;
		providerLabelInName: boolean;
		apiRules: ApiRule[];
	};
	modelOverrides: Record<string, ModelOverride>;
};

export type ApertureProviderConfigInput = Partial<{
	providerName: string;
	baseUrl: string;
	apiKey: string;
	modelsPath: string;
	modelsDev: Partial<ApertureProviderConfig["modelsDev"]>;
	resolution: Partial<ApertureProviderConfig["resolution"]>;
	modelOverrides: Record<string, ModelOverride>;
}>;

export type BuildRegistrationResult = {
	registrations: NamedProviderRegistration[];
	summary: string;
	modelsDevSummary: string;
};

export type ApertureProviderRuntime = {
	sync(
		registrar: ProviderRegistrar,
		ctx?: SyncContext,
		options?: { forceRefreshModelsDev?: boolean }
	): Promise<void>;
	buildRegistration(options?: {
		forceRefreshModelsDev?: boolean;
	}): Promise<BuildRegistrationResult>;
	fetchApertureModels(): Promise<ApertureModel[]>;
	fetchModelsDevIndex(forceRefresh?: boolean): Promise<ModelsDevIndex>;
	getState(): {
		lastSyncSummary: string;
		lastModelsDevSummary: string;
	};
	getConfig(): ApertureProviderConfig;
};
