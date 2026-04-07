import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import {
	createApertureProviderRuntime,
	loadResolvedApertureProviderConfig,
	toPiProviderRegistration,
} from "../dist/index.js";

const PACKAGE_ROOT = new URL("../", import.meta.url);

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
		ctx as never,
		{ forceRefreshModelsDev },
	);

	return runtime;
}

export default function apertureProviderExtension(pi: ExtensionAPI) {
	void syncProvider(pi).catch((error) => {
		console.error("failed to sync aperture provider", error);
	});

	pi.on("session_start", async (_event, ctx) => {
		await syncProvider(pi, ctx as ExtensionCommandContext).catch((error) => {
			console.error("failed to sync aperture provider on session start", error);
		});
	});

	pi.registerCommand("aperture-gateway-refresh", {
		description: "Refresh models from the Aperture gateway and models.dev",
		handler: async (_args, ctx) => {
			await syncProvider(pi, ctx, true);
		},
	});

	pi.registerCommand("aperture-gateway-status", {
		description: "Show Aperture gateway sync status",
		handler: async (_args, ctx) => {
			const runtime = await syncProvider(pi, ctx);
			const state = runtime.getState();
			ctx.ui.notify(
				`Aperture gateway: ${state.lastSyncSummary}; models.dev: ${state.lastModelsDevSummary}`,
				"info",
			);
		},
	});
}
