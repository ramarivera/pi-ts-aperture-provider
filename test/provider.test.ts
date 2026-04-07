import assert from "node:assert/strict";
import test from "node:test";

import {
	createApertureProviderRuntime,
	defineApertureProviderConfig,
	enrichApertureModelMetadata,
} from "../src/index.js";

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
		const { registration } = await runtime.buildRegistration();

		assert.equal(registration.models[0]?.api, "anthropic-messages");
		assert.equal(registration.models[0]?.reasoning, true);
		assert.deepEqual(registration.models[0]?.input, ["text"]);
		assert.equal(registration.models[0]?.contextWindow, 200000);
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
			registration: Awaited<ReturnType<typeof runtime.buildRegistration>>["registration"];
		}> = [];

		await runtime.sync({
			registerProvider(name, registration) {
				registrations.push({ name, registration });
			},
		});

		assert.equal(registrations.length, 1);
		assert.equal(registrations[0]?.name, "custom-aperture");
		assert.equal(registrations[0]?.registration.models[0]?.api, "openai-responses");
		assert.equal(registrations[0]?.registration.models[0]?.contextWindow, 128000);
		assert.equal(registrations[0]?.registration.models[0]?.maxTokens, 32000);
		assert.equal(runtime.getState().lastSyncSummary.includes("1 models"), true);
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
