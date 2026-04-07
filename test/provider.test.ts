import assert from "node:assert/strict";
import test from "node:test";

import { createGatewayProviderRuntime, defineGatewayProviderConfig, enrichGatewayModelMetadata, inferApi } from "../src/index.js";

test("inferApi uses config rules instead of Aperture-specific defaults", () => {
	const config = defineGatewayProviderConfig({
		providerName: "shared-gateway",
		baseUrl: "https://gateway.example/v1",
	});

	const anthropicModel = {
		id: "claude-sonnet-4",
		metadata: {
			provider: {
				id: "anthropic",
				name: "Anthropic",
				description: "Anthropic via /v1/messages",
			},
		},
	};

	assert.equal(inferApi(anthropicModel, config), "anthropic-messages");
});

test("models.dev enrichment matches provider aliases and normalized model ids", () => {
	const config = defineGatewayProviderConfig({
		providerName: "shared-gateway",
		baseUrl: "https://gateway.example/v1",
		modelsDev: {
			providerAliases: {
				"openai-responses": ["custom-openai"],
			},
		},
	});

	const runtime = createGatewayProviderRuntime(config);
	const index = runtime.getConfig().modelsDev.providerAliases;

	assert.deepEqual(index["openai-responses"].includes("custom-openai"), true);

	const enrichment = enrichGatewayModelMetadata(
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
		},
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
								},
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
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
								limit: {
									context: 128000,
									output: 16384,
								},
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const runtime = createGatewayProviderRuntime({
			providerName: "custom-gateway",
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

		const registrations: Array<{ name: string; registration: Awaited<ReturnType<typeof runtime.buildRegistration>>["registration"] }> = [];

		await runtime.sync({
			registerProvider(name, registration) {
				registrations.push({ name, registration });
			},
		});

		assert.equal(registrations.length, 1);
		assert.equal(registrations[0]?.name, "custom-gateway");
		assert.equal(registrations[0]?.registration.models[0]?.contextWindow, 128000);
		assert.equal(registrations[0]?.registration.models[0]?.maxTokens, 32000);
		assert.equal(runtime.getState().lastSyncSummary.includes("1 models"), true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
