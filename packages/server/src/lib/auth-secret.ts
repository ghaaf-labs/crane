import { readSecret } from "../db/constants";

const { BETTER_AUTH_SECRET, BETTER_AUTH_SECRET_FILE } = process.env;

function resolveBetterAuthSecret(): string {
	if (BETTER_AUTH_SECRET) {
		return BETTER_AUTH_SECRET;
	}
	if (BETTER_AUTH_SECRET_FILE) {
		return readSecret(BETTER_AUTH_SECRET_FILE);
	}
	// Fixed, non-production value for the test runner only.
	if (process.env.NODE_ENV === "test") {
		return "test-only-better-auth-secret";
	}
	// `next build` collects server modules without runtime secrets present; no
	// tokens are signed during the build, so a placeholder is safe there only.
	if (process.env.NEXT_PHASE === "phase-production-build") {
		return "build-time-placeholder-not-used-at-runtime";
	}
	// Fail closed: refuse to start without a real secret rather than silently
	// signing every session/cookie/reset token/API key with a known default.
	throw new Error(
		"BETTER_AUTH_SECRET is not set. Provide it via the BETTER_AUTH_SECRET " +
			"environment variable or BETTER_AUTH_SECRET_FILE (Docker secret). " +
			"Refusing to start with an insecure default.",
	);
}

export const betterAuthSecret = resolveBetterAuthSecret();
