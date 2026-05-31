// Whitelabeling was a DSAL/proprietary feature removed during the Apache-2.0
// relicensing. These hooks are stubbed to always report "no config" until the
// feature is rebuilt. The config type is preserved (always null at runtime) so
// the existing consumers — which read fields via optional chaining — keep
// type-checking without edits.

type WhitelabelingConfig = {
	appName: string | null;
	appDescription: string | null;
	logoUrl: string | null;
	faviconUrl: string | null;
	customCss: string | null;
	loginLogoUrl: string | null;
	supportUrl: string | null;
	docsUrl: string | null;
	errorPageTitle: string | null;
	errorPageDescription: string | null;
	metaTitle: string | null;
	footerText: string | null;
};

export function useWhitelabeling(): { config: WhitelabelingConfig | null } {
	return { config: null };
}

export function useWhitelabelingPublic(): { config: WhitelabelingConfig | null } {
	return { config: null };
}
