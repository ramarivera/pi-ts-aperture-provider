import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import {
	createApertureProviderRuntime,
	loadResolvedApertureProviderConfig,
	toPiProviderRegistration,
} from "../dist/index.js";

const PACKAGE_ROOT = new URL("../", import.meta.url);

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Unknown error while syncing aperture provider.";
}

function summarizeSyncError(error: unknown): string {
	const message = getErrorMessage(error);

	const missingMetadata = message.match(
		/Missing required "([^"]+)" metadata for model "([^"]+)"/,
	);
	if (missingMetadata) {
		const [, field, model] = missingMetadata;
		return [
			`Model \"${model}\" is missing required metadata: ${field}.`,
			"Add a modelOverrides entry for this model in your aperture-provider.config.json,",
			"or ensure models.dev has this model with complete capabilities.",
		].join(" ");
	}

	const cannotRegister = message.match(
		/Model \"([^\"]+)\" cannot be registered without \"([^\"]+)\" metadata/,
	);
	if (cannotRegister) {
		const [, model, field] = cannotRegister;
		return `Model \"${model}\" is missing ${field} metadata and cannot be registered.`;
	}

	const cannotResolve = message.match(
		/Could not resolve API type for model \"([^\"]+)\"/,
	);
	if (cannotResolve) {
		const [, model] = cannotResolve;
		return `Could not resolve API type for model \"${model}\". Check provider metadata and /aperture/config API rules.`;
	}

	return message;
}

function reportSyncFailure(context: ExtensionCommandContext | undefined, error: unknown) {
	const summary = summarizeSyncError(error);
	const prefix = "Aperture provider sync failed:";
	const message = `${prefix} ${summary}`;
	const showDebug = process?.env?.PI_APERTURE_DEBUG === "1" || process?.env?.PI_APERTURE_DEBUG === "true";

	if (context?.ui) {
		context.ui.notify(message, "error");
	}

	if (showDebug) {
		console.error(message);
		console.error(`Aperture provider sync failed (raw):`, error);
	}
}

async function syncProvider(
	pi: ExtensionAPI,
	ctx?: ExtensionCommandContext,
	forceRefreshModelsDev = false,
) {
	const { config } = await loadResolvedApertureProviderConfig({
		cwd: ctx?.cwd,
		packageRoot: PACKAGE_ROOT,
	});
	const runtime = createApertureProviderRuntime(config);

	await runtime.sync(
		{
			registerProvider(name, registration) {
				pi.registerProvider(name, toPiProviderRegistration(registration) as never);
			},
		},
		undefined as never,
		{ forceRefreshModelsDev },
	);

	return runtime;
}

export default function apertureProviderExtension(pi: ExtensionAPI) {
	void syncProvider(pi).catch((error) => {
		reportSyncFailure(undefined, error);
	});

	pi.on("session_start", async (_event, ctx) => {
		await syncProvider(pi, ctx as ExtensionCommandContext).catch((error) => {
			reportSyncFailure(ctx as ExtensionCommandContext, error);
		});
	});

	pi.registerCommand("aperture-gateway-refresh", {
		description: "Refresh models from the Aperture gateway and models.dev",
		handler: async (_args, ctx) => {
			await syncProvider(pi, ctx, true).catch((error) => {
				reportSyncFailure(ctx, error);
			});
		},
	});

	pi.registerCommand("aperture-gateway-status", {
		description: "Show Aperture gateway sync status",
		handler: async (_args, ctx) => {
			const runtime = await syncProvider(pi, ctx).catch((error) => {
				reportSyncFailure(ctx as ExtensionCommandContext, error);
			});
			if (!runtime) {
				return;
			}
			const state = runtime.getState();
			ctx.ui.notify(
				`Aperture gateway: ${state.lastSyncSummary}; models.dev: ${state.lastModelsDevSummary}`,
				"info",
			);
		},
	});
}
