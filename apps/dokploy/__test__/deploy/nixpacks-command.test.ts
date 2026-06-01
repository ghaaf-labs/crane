import { describe, expect, it, vi } from "vitest";

// nanoid makes the build-container id non-deterministic; pin only `nanoid` so the
// command is a stable golden, keeping customAlphabet (used by the schema) real.
vi.mock("nanoid", async (importOriginal) => {
	const actual = await importOriginal<typeof import("nanoid")>();
	return { ...actual, nanoid: () => "FIXEDID123" };
});

const { getNixpacksCommand } = await import(
	"@crane/server/utils/builders/nixpacks"
);

// Crane: characterization tests for the nixpacks builder (the common default).
const baseApp = (overrides: Record<string, unknown> = {}) =>
	({
		applicationId: "app-id",
		name: "Nixpacks",
		appName: "test-app",
		sourceType: "git" as const,
		buildType: "nixpacks" as const,
		buildPath: "/",
		customGitBuildPath: null,
		dockerfile: null,
		publishDirectory: null,
		isStaticSpa: false,
		env: null,
		cleanCache: false,
		serverId: null,
		buildServerId: null,
		environment: { env: "", project: { env: "" } },
		...overrides,
	}) as never;

describe("getNixpacksCommand", () => {
	it("runs `nixpacks build … --name <app>` with start/fail/done guards", () => {
		const cmd = getNixpacksCommand(baseApp());
		expect(cmd).toContain("nixpacks build");
		expect(cmd).toContain("--name test-app");
		expect(cmd).toContain('echo "Starting nixpacks build..."');
		expect(cmd).toContain("❌ Nixpacks build failed");
		expect(cmd).toContain("✅ Nixpacks build completed.");
	});

	it("adds --no-cache only when cleanCache is set", () => {
		expect(getNixpacksCommand(baseApp({ cleanCache: true }))).toContain(
			"--no-cache",
		);
		expect(getNixpacksCommand(baseApp())).not.toContain("--no-cache");
	});

	it("passes env vars as --env", () => {
		expect(
			getNixpacksCommand(baseApp({ env: "NODE_ENV=production" })),
		).toContain("--env");
	});

	it("does not extract artifacts when there is no publishDirectory", () => {
		const cmd = getNixpacksCommand(baseApp());
		expect(cmd).not.toContain("--no-error-without-start");
		expect(cmd).not.toContain("docker create");
	});

	it("extracts artifacts + runs a static build when publishDirectory is set", () => {
		const cmd = getNixpacksCommand(baseApp({ publishDirectory: "dist" }));
		// Skip the start command, then copy artifacts out of a deterministic
		// build container, clean it up, and hand off to the static (nginx) build.
		expect(cmd).toContain("--no-error-without-start");
		expect(cmd).toContain("docker create --name test-app-FIXEDID123 test-app");
		expect(cmd).toContain("docker cp test-app-FIXEDID123:/app/dist");
		expect(cmd).toContain("docker rm test-app-FIXEDID123");
		// The static hand-off ends in a docker build of the nginx image.
		expect(cmd).toContain("docker build -t test-app");
	});
});
