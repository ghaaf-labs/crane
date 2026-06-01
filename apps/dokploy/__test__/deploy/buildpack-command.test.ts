import { getHerokuCommand } from "@crane/server/utils/builders/heroku";
import { getPaketoCommand } from "@crane/server/utils/builders/paketo";
import { describe, expect, it } from "vitest";

// Crane: characterization tests for the buildpack (`pack build`) builders. Golden
// behavior for the Rust port; assertions target the stable command structure
// (not the env-dependent absolute build path).

const baseApp = (overrides: Record<string, unknown> = {}) =>
	({
		applicationId: "app-id",
		name: "Buildpack",
		appName: "test-app",
		sourceType: "git" as const,
		buildType: "heroku_buildpacks" as const,
		buildPath: "/",
		customGitBuildPath: null,
		dockerfile: null,
		env: null,
		cleanCache: false,
		herokuVersion: null,
		serverId: null,
		buildServerId: null,
		environment: { env: "", project: { env: "" } },
		...overrides,
	}) as never;

describe("getHerokuCommand", () => {
	it("builds with the default heroku builder (v24) and success/failure guards", () => {
		const cmd = getHerokuCommand(baseApp());
		expect(cmd).toContain("pack build test-app --path");
		expect(cmd).toContain("--builder heroku/builder:24");
		expect(cmd).toContain('echo "Starting heroku build..."');
		expect(cmd).toContain("❌ Heroku build failed");
		expect(cmd).toContain("✅ Heroku build completed.");
	});

	it("honors a pinned herokuVersion", () => {
		expect(getHerokuCommand(baseApp({ herokuVersion: "22" }))).toContain(
			"--builder heroku/builder:22",
		);
	});

	it("adds --clear-cache only when cleanCache is set", () => {
		expect(getHerokuCommand(baseApp({ cleanCache: true }))).toContain(
			"--clear-cache",
		);
		expect(getHerokuCommand(baseApp())).not.toContain("--clear-cache");
	});

	it("passes env vars as --env", () => {
		expect(getHerokuCommand(baseApp({ env: "NODE_ENV=production" }))).toContain(
			"--env",
		);
	});
});

describe("getPaketoCommand", () => {
	it("builds with the paketo jammy-full builder and success/failure guards", () => {
		const cmd = getPaketoCommand(baseApp());
		expect(cmd).toContain("pack build test-app --path");
		expect(cmd).toContain("--builder paketobuildpacks/builder-jammy-full");
		expect(cmd).toContain('echo "Starting Paketo build..."');
		expect(cmd).toContain("❌ Paketo build failed");
		expect(cmd).toContain("✅ Paketo build completed.");
	});

	it("adds --clear-cache only when cleanCache is set", () => {
		expect(getPaketoCommand(baseApp({ cleanCache: true }))).toContain(
			"--clear-cache",
		);
		expect(getPaketoCommand(baseApp())).not.toContain("--clear-cache");
	});
});
