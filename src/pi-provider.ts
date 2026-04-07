import {
	type Model,
	type SimpleStreamOptions,
	type StreamFunction,
	streamSimpleAnthropic,
	streamSimpleOpenAICompletions,
	streamSimpleOpenAIResponses,
} from "@mariozechner/pi-ai";

import type { ProviderApi, ProviderRegistration } from "./types";

type PiSimpleStream = StreamFunction<ProviderApi, SimpleStreamOptions>;

type StreamResolver = {
	anthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions>;
	openaiCompletions: StreamFunction<"openai-completions", SimpleStreamOptions>;
	openaiResponses: StreamFunction<"openai-responses", SimpleStreamOptions>;
};

export type PiProviderRegistration = ProviderRegistration & {
	streamSimple: PiSimpleStream;
};

const SESSION_ID_HEADER = "session_id";
const ANTHROPIC_SESSION_DEVICE_ID = "pi-ts-aperture-provider";

const DEFAULT_STREAM_RESOLVER: StreamResolver = {
	anthropic: streamSimpleAnthropic,
	openaiCompletions: streamSimpleOpenAICompletions,
	openaiResponses: streamSimpleOpenAIResponses,
};

export function attachSessionTrackingHeaders(
	headers: Record<string, string> | undefined,
	sessionId: string | undefined
): Record<string, string> | undefined {
	if (!sessionId) {
		return headers;
	}

	return {
		...(headers ?? {}),
		[SESSION_ID_HEADER]: sessionId,
	};
}

function attachAnthropicSessionTrackingMetadata(
	metadata: SimpleStreamOptions["metadata"] | undefined,
	sessionId: string
): SimpleStreamOptions["metadata"] {
	return {
		...(metadata ?? {}),
		user_id: JSON.stringify({
			device_id: ANTHROPIC_SESSION_DEVICE_ID,
			account_uuid: "",
			session_id: sessionId,
		}),
	};
}

function withSessionTracking(
	api: ProviderApi,
	options: SimpleStreamOptions | undefined
): SimpleStreamOptions | undefined {
	if (!options?.sessionId) {
		return options;
	}

	return {
		...options,
		headers: attachSessionTrackingHeaders(options.headers, options.sessionId),
		metadata:
			api === "anthropic-messages"
				? attachAnthropicSessionTrackingMetadata(options.metadata, options.sessionId)
				: options.metadata,
	};
}

export function createSessionTrackedStreamSimple(
	api: ProviderApi,
	resolveStream: StreamResolver = DEFAULT_STREAM_RESOLVER
): PiSimpleStream {
	switch (api) {
		case "anthropic-messages":
			return ((model, context, options) =>
				resolveStream.anthropic(
					model as Model<"anthropic-messages">,
					context,
					withSessionTracking("anthropic-messages", options)
				)) as PiSimpleStream;
		case "openai-completions":
			return ((model, context, options) =>
				resolveStream.openaiCompletions(
					model as Model<"openai-completions">,
					context,
					withSessionTracking("openai-completions", options)
				)) as PiSimpleStream;
		case "openai-responses":
			return ((model, context, options) =>
				resolveStream.openaiResponses(
					model as Model<"openai-responses">,
					context,
					withSessionTracking("openai-responses", options)
				)) as PiSimpleStream;
	}
}

export function toPiProviderRegistration(
	registration: ProviderRegistration,
	resolveStream: StreamResolver = DEFAULT_STREAM_RESOLVER
): PiProviderRegistration {
	return {
		...registration,
		streamSimple: createSessionTrackedStreamSimple(registration.api, resolveStream),
	};
}
