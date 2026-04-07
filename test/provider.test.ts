import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createApertureProviderRuntime,
	defaultApertureProviderConfigSearchPaths,
	defineApertureProviderConfig,
	enrichApertureModelMetadata,
	loadResolvedApertureProviderConfig,
	resolveApertureProviderConfigPath,
} from "../src/index";

test("runtime resolves api type from provider metadata and models.dev", async () => {
	const config = defineApertureProviderConfig({
		providerName: "shared-aperture",
		baseUrl: "https://gateway.example/v1",
		modelsDev: {
			url: "https://catalog.example/models.dev.json",
		},
	});

	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url === "https://gateway.example/v1/models") {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "claude-sonnet-4",
							metadata: {
								provider: {
									id: "provider-1",
									name: "Anthropic Gateway",
									description: "Models exposed via /v1/messages",
								},
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}
		if (url === "https://catalog.example/models.dev.json") {
			return new Response(
				JSON.stringify({
					anthropic: {
						id: "anthropic",
						name: "Anthropic",
						models: {
							"claude-sonnet-4": {
								id: "claude-sonnet-4",
								reasoning: true,
								modalities: { input: ["text"] },
								limit: { context: 200000, output: 16384 },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const runtime = createApertureProviderRuntime(config);
		const { registrations } = await runtime.buildRegistration();
		const registration = registrations[0]?.registration;

		assert.equal(registrations[0]?.name, "shared-aperture");
		assert.equal(registration?.api, "anthropic-messages");
		assert.equal(registration?.models[0]?.api, "anthropic-messages");
		assert.equal(registration?.models[0]?.name, "claude-sonnet-4 (provider-1)");
		assert.equal(registration?.models[0]?.reasoning, true);
		assert.deepEqual(registration?.models[0]?.input, ["text"]);
		assert.equal(registration?.models[0]?.contextWindow, 200000);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runtime prefers aperture config compatibility over provider metadata hints", async () => {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url === "https://gateway.example/aperture/config") {
			return new Response(
				JSON.stringify({
					config: `{
						"providers": {
							"provider-1": {
								"compatibility": {
									"openai_chat": false,
									"anthropic_messages": true,
									"openai_responses": false,
								},
							},
						},
					}`,
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://gateway.example/v1/models") {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "claude-sonnet-4",
							metadata: {
								provider: {
									id: "provider-1",
									name: "Anthropic Gateway",
									description: "Actually misleadingly labeled via /v1/chat/completions",
								},
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://catalog.example/models.dev.json") {
			return new Response(
				JSON.stringify({
					anthropic: {
						id: "anthropic",
						name: "Anthropic",
						models: {
							"claude-sonnet-4": {
								id: "claude-sonnet-4",
								reasoning: true,
								modalities: { input: ["text"] },
								limit: { context: 200000, output: 16384 },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const runtime = createApertureProviderRuntime({
			providerName: "shared-aperture",
			baseUrl: "https://gateway.example/v1",
			modelsDev: {
				url: "https://catalog.example/models.dev.json",
			},
		});
		const { registrations } = await runtime.buildRegistration();

		assert.equal(registrations[0]?.registration.api, "anthropic-messages");
		assert.equal(registrations[0]?.registration.models[0]?.api, "anthropic-messages");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("models.dev enrichment matches provider aliases and normalized model ids", () => {
	const config = defineApertureProviderConfig({
		providerName: "shared-aperture",
		baseUrl: "https://gateway.example/v1",
		modelsDev: {
			providerAliases: {
				"openai-responses": ["custom-openai"],
			},
		},
	});

	const runtime = createApertureProviderRuntime(config);
	const index = runtime.getConfig().modelsDev.providerAliases;

	assert.deepEqual(index["openai-responses"].includes("custom-openai"), true);

	const enrichment = enrichApertureModelMetadata(
		{
			id: "gpt-5-highspeed",
			metadata: {
				provider: {
					id: "custom-openai",
					name: "Custom OpenAI",
				},
			},
		},
		{
			providers: new Map(),
			providerAliases: new Map([["custom-openai", ["openai-responses"]]]),
			modelsByProviderAndId: new Map([
				[
					"openai-responses:gpt-5",
					{
						providerId: "openai-responses",
						providerName: "OpenAI Responses",
						modelKey: "gpt-5",
						model: {
							reasoning: true,
							limit: {
								context: 128000,
								output: 32768,
							},
						},
					},
				],
			]),
			modelsById: new Map(),
			modelsByName: new Map(),
		}
	);

	assert.equal(enrichment.reasoning, true);
	assert.equal(enrichment.contextWindow, 128000);
	assert.equal(enrichment.maxTokens, 32768);
});

test("models.dev enrichment derives generic provider hints from metadata phrases", () => {
	const enrichment = enrichApertureModelMetadata(
		{
			id: "claude-sonnet-4",
			metadata: {
				provider: {
					name: "OpenCode Zen Black",
					description: "OpenCode Zen Black models exposed via /v1/messages",
				},
			},
		},
		{
			providers: new Map(),
			providerAliases: new Map([["opencode", ["opencode"]]]),
			modelsByProviderAndId: new Map([
				[
					"opencode:claude-sonnet-4",
					{
						providerId: "opencode",
						providerName: "OpenCode",
						modelKey: "claude-sonnet-4",
						model: {
							reasoning: true,
							modalities: {
								input: ["text"],
							},
							limit: {
								context: 200000,
								output: 16384,
							},
						},
					},
				],
			]),
			modelsById: new Map(),
			modelsByName: new Map(),
		}
	);

	assert.equal(enrichment.reasoning, true);
	assert.deepEqual(enrichment.input, ["text"]);
	assert.equal(enrichment.contextWindow, 200000);
	assert.equal(enrichment.maxTokens, 16384);
});

test("runtime builds registration from config and model overrides", async () => {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input) => {
		const url = String(input);

		if (url === "https://gateway.example/v1/models") {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "openai/gpt-5",
							metadata: {
								provider: {
									id: "openai",
									name: "OpenAI",
									description: "OpenAI Responses via /v1/responses",
								},
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://catalog.example/models.dev.json") {
			return new Response(
				JSON.stringify({
					openai: {
						id: "openai",
						name: "OpenAI",
						models: {
							"gpt-5": {
								id: "openai/gpt-5",
								reasoning: true,
								modalities: {
									input: ["text"],
								},
								limit: {
									context: 128000,
									output: 16384,
								},
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const runtime = createApertureProviderRuntime({
			providerName: "custom-aperture",
			baseUrl: "https://gateway.example/v1",
			modelsDev: {
				url: "https://catalog.example/models.dev.json",
			},
			modelOverrides: {
				"openai/gpt-5": {
					maxTokens: 32000,
				},
			},
		});

		const registrations: Array<{
			name: string;
			registration: Awaited<
				ReturnType<typeof runtime.buildRegistration>
			>["registrations"][number]["registration"];
		}> = [];

		await runtime.sync({
			registerProvider(name, registration) {
				registrations.push({ name, registration });
			},
		});

		assert.equal(registrations.length, 1);
		assert.equal(registrations[0]?.name, "custom-aperture");
		assert.equal(registrations[0]?.registration.api, "openai-responses");
		assert.equal(registrations[0]?.registration.models[0]?.name, "openai/gpt-5 (openai)");
		assert.equal(registrations[0]?.registration.models[0]?.api, "openai-responses");
		assert.equal(registrations[0]?.registration.models[0]?.contextWindow, 128000);
		assert.equal(registrations[0]?.registration.models[0]?.maxTokens, 32000);
		assert.equal(runtime.getState().lastSyncSummary.includes("1 models"), true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runtime splits mixed API models into separate provider registrations", async () => {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input) => {
		const url = String(input);

		if (url === "https://gateway.example/aperture/config") {
			return new Response(
				JSON.stringify({
					config: `{
						"providers": {
							"minimax": {
								"compatibility": {
									"openai_chat": false,
									"anthropic_messages": true,
									"openai_responses": false
								}
							},
							"alibaba": {
								"compatibility": {
									"openai_chat": true,
									"anthropic_messages": false,
									"openai_responses": false
								}
							}
						}
					}`,
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://gateway.example/v1/models") {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "MiniMax-M2.7-highspeed",
							metadata: {
								provider: {
									id: "minimax",
									name: "Minimax Coding Plan",
									description: "Minimax Coding Plan",
								},
							},
						},
						{
							id: "MiniMax-M2.5",
							metadata: {
								provider: {
									id: "alibaba",
									name: "Alibaba Coding Plan",
									description: "Alibaba Coding Plan",
								},
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://catalog.example/models.dev.json") {
			return new Response(
				JSON.stringify({
					"minimax-coding-plan": {
						id: "minimax-coding-plan",
						name: "MiniMax Coding Plan",
						models: {
							"MiniMax-M2.7-highspeed": {
								id: "MiniMax-M2.7-highspeed",
								reasoning: true,
								modalities: { input: ["text"] },
								limit: { context: 204800, output: 131072 },
							},
						},
					},
					alibaba: {
						id: "alibaba",
						name: "Alibaba",
						models: {
							"MiniMax-M2.5": {
								id: "MiniMax-M2.5",
								reasoning: true,
								modalities: { input: ["text"] },
								limit: { context: 200000, output: 8192 },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const runtime = createApertureProviderRuntime({
			providerName: "aperture-gateway",
			baseUrl: "https://gateway.example/v1",
			modelsDev: {
				url: "https://catalog.example/models.dev.json",
			},
		});

		const registrations: Array<{
			name: string;
			registration: Awaited<
				ReturnType<typeof runtime.buildRegistration>
			>["registrations"][number]["registration"];
		}> = [];

		await runtime.sync({
			registerProvider(name, registration) {
				registrations.push({ name, registration });
			},
		});

		assert.deepEqual(
			registrations.map((entry) => entry.name).sort(),
			["aperture-gateway-anthropic", "aperture-gateway-openai"].sort()
		);
		assert.equal(
			registrations.find((entry) => entry.name === "aperture-gateway-anthropic")?.registration
				.baseUrl,
			"https://gateway.example"
		);
		assert.equal(
			registrations.find((entry) => entry.name === "aperture-gateway-openai")?.registration.baseUrl,
			"https://gateway.example/v1"
		);
		assert.equal(
			registrations.find((entry) => entry.name === "aperture-gateway-anthropic")?.registration
				.models[0]?.name,
			"MiniMax-M2.7-highspeed (minimax)"
		);
		assert.equal(
			registrations.find((entry) => entry.name === "aperture-gateway-openai")?.registration
				.models[0]?.name,
			"MiniMax-M2.5 (alibaba)"
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runtime can omit source provider labels from model names", async () => {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input) => {
		const url = String(input);

		if (url === "https://gateway.example/v1/models") {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "MiniMax-M2.7-highspeed",
							metadata: {
								provider: {
									id: "minimax",
									name: "Minimax Coding Plan",
									description: "Minimax Coding Plan",
								},
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://gateway.example/aperture/config") {
			return new Response(
				JSON.stringify({
					config: `{
						"providers": {
							"minimax": {
								"compatibility": {
									"openai_chat": false,
									"anthropic_messages": true,
									"openai_responses": false
								}
							}
						}
					}`,
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://catalog.example/models.dev.json") {
			return new Response(
				JSON.stringify({
					"minimax-coding-plan": {
						id: "minimax-coding-plan",
						name: "MiniMax Coding Plan",
						models: {
							"MiniMax-M2.7-highspeed": {
								id: "MiniMax-M2.7-highspeed",
								reasoning: true,
								modalities: { input: ["text"] },
								limit: { context: 204800, output: 131072 },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const runtime = createApertureProviderRuntime({
			providerName: "aperture-gateway",
			baseUrl: "https://gateway.example/v1",
			modelsDev: {
				url: "https://catalog.example/models.dev.json",
			},
			resolution: {
				providerLabelInName: false,
			},
		});

		const { registrations } = await runtime.buildRegistration();
		assert.equal(registrations[0]?.registration.models[0]?.name, "MiniMax-M2.7-highspeed");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runtime fails when capabilities are missing and no override exists", async () => {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input) => {
		const url = String(input);

		if (url === "https://gateway.example/v1/models") {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "unknown-model",
							metadata: {
								provider: {
									id: "provider-x",
									name: "OpenAI Chat Gateway",
									description: "Provider exposed via /v1/chat/completions",
								},
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			);
		}

		if (url === "https://catalog.example/models.dev.json") {
			return new Response(JSON.stringify({}), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}

		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const runtime = createApertureProviderRuntime({
			providerName: "strict-aperture",
			baseUrl: "https://gateway.example/v1",
			modelsDev: {
				url: "https://catalog.example/models.dev.json",
			},
		});

		await assert.rejects(
			() => runtime.buildRegistration(),
			/Missing required "reasoning" metadata/
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("resolved config search path order is env, project, user, then package", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-ts-aperture-provider-"));
	const projectDir = join(root, "workspace");
	const userHome = join(root, "home");
	const packageRoot = join(root, "package");
	const envConfig = join(root, "env-config.json");
	const projectConfig = join(projectDir, ".pi", "aperture-provider.config.json");
	const userConfig = join(userHome, ".pi", "agent", "aperture-provider.config.json");
	const packageConfig = join(packageRoot, "aperture-provider.config.json");
	const originalEnvConfig = process.env.PI_APERTURE_PROVIDER_CONFIG;
	const originalHome = process.env.HOME;

	process.env.HOME = userHome;
	process.env.PI_APERTURE_PROVIDER_CONFIG = envConfig;

	try {
		await mkdir(join(projectDir, ".pi"), { recursive: true });
		await mkdir(join(userHome, ".pi", "agent"), { recursive: true });
		await mkdir(packageRoot, { recursive: true });
		await writeFile(
			envConfig,
			JSON.stringify({ providerName: "env", baseUrl: "https://env.example/v1" })
		);
		await writeFile(
			projectConfig,
			JSON.stringify({ providerName: "project", baseUrl: "https://project.example/v1" })
		);
		await writeFile(
			userConfig,
			JSON.stringify({ providerName: "user", baseUrl: "https://user.example/v1" })
		);
		await writeFile(
			packageConfig,
			JSON.stringify({ providerName: "package", baseUrl: "https://package.example/v1" })
		);

		assert.deepEqual(defaultApertureProviderConfigSearchPaths({ cwd: projectDir, packageRoot }), [
			envConfig,
			projectConfig,
			userConfig,
			packageConfig,
		]);
		assert.equal(
			await resolveApertureProviderConfigPath({ cwd: projectDir, packageRoot }),
			envConfig
		);

		process.env.PI_APERTURE_PROVIDER_CONFIG = undefined;
		assert.equal(
			await resolveApertureProviderConfigPath({ cwd: projectDir, packageRoot }),
			projectConfig
		);

		await rm(projectConfig, { force: true });
		assert.equal(
			await resolveApertureProviderConfigPath({ cwd: projectDir, packageRoot }),
			userConfig
		);

		await rm(userConfig, { force: true });
		assert.equal(
			await resolveApertureProviderConfigPath({ cwd: projectDir, packageRoot }),
			packageConfig
		);
	} finally {
		if (originalEnvConfig === undefined) {
			delete process.env.PI_APERTURE_PROVIDER_CONFIG;
		} else {
			process.env.PI_APERTURE_PROVIDER_CONFIG = originalEnvConfig;
		}
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await rm(root, { recursive: true, force: true });
	}
});

test("loadResolvedApertureProviderConfig returns parsed config and source path", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-ts-aperture-provider-load-"));
	const projectDir = join(root, "workspace");
	const packageRoot = join(root, "package");
	const projectConfig = join(projectDir, ".pi", "aperture-provider.config.json");

	try {
		await mkdir(join(projectDir, ".pi"), { recursive: true });
		await mkdir(packageRoot, { recursive: true });
		await writeFile(
			projectConfig,
			JSON.stringify({ providerName: "project-aperture", baseUrl: "https://project.example/v1" })
		);

		const resolved = await loadResolvedApertureProviderConfig({
			cwd: projectDir,
			packageRoot,
			env: {},
		});

		assert.equal(resolved.path, projectConfig);
		assert.equal(resolved.config.providerName, "project-aperture");
		assert.equal(resolved.config.baseUrl, "https://project.example/v1");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
