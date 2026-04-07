export type ProviderApi = "openai-completions" | "openai-responses" | "anthropic-messages";

export type ProviderInput = "text" | "image";

export type GatewayModel = {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
	metadata?: {
		provider?: {
			id?: string;
			name?: string;
			description?: string;
		};
	};
	pricing?: Record<string, string>;
};

export type GatewayModelsResponse = {
	object?: string;
	data?: GatewayModel[];
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

export type GatewayModelEnrichment = {
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

export type NumericRule = {
	match: string[];
	value: number;
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

export type GatewayProviderConfig = {
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
	heuristics: {
		defaultApi: ProviderApi;
		providerLabelInName: boolean;
		apiRules: ApiRule[];
		reasoningTokens: string[];
		imageTokens: string[];
		contextWindowRules: NumericRule[];
		maxTokensRules: NumericRule[];
	};
	modelOverrides: Record<string, ModelOverride>;
};

export type GatewayProviderConfigInput = Partial<{
	providerName: string;
	baseUrl: string;
	apiKey: string;
	modelsPath: string;
	modelsDev: Partial<GatewayProviderConfig["modelsDev"]>;
	heuristics: Partial<GatewayProviderConfig["heuristics"]>;
	modelOverrides: Record<string, ModelOverride>;
}>;

export type BuildRegistrationResult = {
	registration: ProviderRegistration;
	summary: string;
	modelsDevSummary: string;
};

export type GatewayProviderRuntime = {
	sync(registrar: ProviderRegistrar, ctx?: SyncContext, options?: { forceRefreshModelsDev?: boolean }): Promise<void>;
	buildRegistration(options?: { forceRefreshModelsDev?: boolean }): Promise<BuildRegistrationResult>;
	fetchGatewayModels(): Promise<GatewayModel[]>;
	fetchModelsDevIndex(forceRefresh?: boolean): Promise<ModelsDevIndex>;
	getState(): {
		lastSyncSummary: string;
		lastModelsDevSummary: string;
	};
	getConfig(): GatewayProviderConfig;
};

