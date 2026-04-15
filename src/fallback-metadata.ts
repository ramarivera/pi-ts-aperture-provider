import type { ApertureModel, FallbackMetadata } from "./types";

function normalizeValue(value: string | null | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.trim()
		.replace(/[_\s/]+/g, "-")
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function providerHints(model: ApertureModel): string[] {
	const hints = [
		model.metadata?.provider?.id,
		model.metadata?.provider?.name,
		model.metadata?.provider?.description,
	]
		.map((value) => normalizeValue(value))
		.filter((value) => value !== "");

	return [...new Set(hints)];
}

function modelKeys(model: ApertureModel): string[] {
	const normalizedId = normalizeValue(model.id);
	const variants = new Set<string>([
		normalizedId,
		normalizedId.replace(/\.(\d+)/g, "-$1"),
		normalizedId.replace(/-(\d+)/g, ".$1"),
		normalizedId.replace(/-latest$/, ""),
		normalizedId.replace(/-thinking$/, ""),
	]);

	return [...variants].filter((value) => value !== "");
}

export function normalizeFallbackMetadataRecord(
	record: Record<string, FallbackMetadata>
): Record<string, FallbackMetadata> {
	return Object.fromEntries(
		Object.entries(record).map(([modelId, metadata]) => [normalizeValue(modelId), metadata])
	);
}

// Cross-reference:
//   - aperture-provider.config.example.json
export const DEFAULT_FALLBACK_METADATA: Record<string, FallbackMetadata> =
	normalizeFallbackMetadataRecord({
		// Kimi / Moonshot
		"K2.5": { reasoning: true, input: ["text"], contextWindow: 262144, maxTokens: 16384 },
		"K2.6-code-preview": {
			reasoning: true,
			input: ["text"],
			contextWindow: 262144,
			maxTokens: 16384,
		},
		"kimi-k2.5": { reasoning: true, input: ["text"], contextWindow: 262144, maxTokens: 16384 },
		"moonshot-k2.5": {
			reasoning: true,
			input: ["text"],
			contextWindow: 262144,
			maxTokens: 16384,
		},
		// OpenAI
		"gpt-5": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 128000,
			maxTokens: 32768,
		},
		"gpt-5-mini": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 128000,
			maxTokens: 32768,
		},
		"gpt-4.1": {
			reasoning: false,
			input: ["text", "image"],
			contextWindow: 1048576,
			maxTokens: 32768,
		},
		"gpt-4o": {
			reasoning: false,
			input: ["text", "image"],
			contextWindow: 128000,
			maxTokens: 16384,
		},
		o3: {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 100000,
		},
		"o4-mini": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 100000,
		},
		// Anthropic
		"claude-sonnet-4": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 64000,
		},
		"claude-opus-4": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 64000,
		},
		"claude-3.7-sonnet": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 64000,
		},
		// Google Gemini
		"gemini-2.5-pro": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		"gemini-2.5-flash": {
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		// Z.ai / GLM
		"glm-4.5": { reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 16384 },
		"z-ai-glm-4.5": {
			reasoning: true,
			input: ["text"],
			contextWindow: 128000,
			maxTokens: 16384,
		},
		// MiniMax
		"minimax-m2.7": {
			reasoning: true,
			input: ["text"],
			contextWindow: 1000000,
			maxTokens: 8192,
		},
		"minimax-m2.7-highspeed": {
			reasoning: true,
			input: ["text"],
			contextWindow: 1000000,
			maxTokens: 8192,
		},
		// Qwen / Alibaba
		"qwen3-coder": {
			reasoning: true,
			input: ["text"],
			contextWindow: 262144,
			maxTokens: 65536,
		},
		"qwen3-max": {
			reasoning: true,
			input: ["text"],
			contextWindow: 262144,
			maxTokens: 65536,
		},
	});

export function resolveFallbackMetadata(
	model: ApertureModel,
	fallbackMetadata: Record<string, FallbackMetadata>
): FallbackMetadata | null {
	const normalizedFallbackMetadata = normalizeFallbackMetadataRecord(fallbackMetadata);

	for (const key of modelKeys(model)) {
		const exact = normalizedFallbackMetadata[key];
		if (exact) {
			return exact;
		}
	}

	const hints = providerHints(model);
	for (const key of modelKeys(model)) {
		for (const [fallbackKey, metadata] of Object.entries(normalizedFallbackMetadata)) {
			if (fallbackKey === key) {
				return metadata;
			}
			const providerMatches = hints.some(
				(hint) => fallbackKey.includes(hint) || hint.includes(fallbackKey)
			);
			if (providerMatches && (key.includes(fallbackKey) || fallbackKey.includes(key))) {
				return metadata;
			}
		}
	}

	return null;
}
