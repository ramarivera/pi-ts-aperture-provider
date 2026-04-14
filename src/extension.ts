import { loadResolvedApertureProviderConfig } from "./config";
import { toPiProviderRegistration } from "./pi-provider";
import { createApertureProviderRuntime } from "./provider";
import type { ApertureProviderRuntime } from "./types";

export type ApertureProviderRegistrar = {
	registerProvider(name: string, registration: ReturnType<typeof toPiProviderRegistration>): void;
};

export type RegisterApertureProvidersOptions = {
	cwd?: string;
	packageRoot?: string | URL;
	forceRefreshModelsDev?: boolean;
	loadConfig?: typeof loadResolvedApertureProviderConfig;
};

export async function registerApertureProviders(
	registrar: ApertureProviderRegistrar,
	options?: RegisterApertureProvidersOptions
): Promise<ApertureProviderRuntime> {
	const loadConfig = options?.loadConfig ?? loadResolvedApertureProviderConfig;
	const { config } = await loadConfig({
		cwd: options?.cwd,
		packageRoot: options?.packageRoot,
	});
	const runtime = createApertureProviderRuntime(config);

	await runtime.sync(
		{
			registerProvider(name, registration) {
				registrar.registerProvider(name, toPiProviderRegistration(registration));
			},
		},
		undefined,
		{ forceRefreshModelsDev: options?.forceRefreshModelsDev }
	);

	return runtime;
}
