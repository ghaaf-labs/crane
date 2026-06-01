import { describe, expect, it, vi } from "vitest";

// Pin only nanoid (the cleanCache cache-key) for a stable golden; keep the rest
// of nanoid (customAlphabet, used by the schema) real.
vi.mock("nanoid", async (importOriginal) => {
	const actual = await importOriginal<typeof import("nanoid")>();
	return { ...actual, nanoid: () => "CACHEKEY99" };
});

const { getRailpackCommand } = await import(
	"@crane/server/utils/builders/railpack"
);

const baseApp = (overrides: Record<string, unknown> = {}) =>
	({
		applicationId: "app-id",
		name: "Railpack",
		appName: "test-app",
		sourceType: "git" as const,
		buildType: "railpack" as const,
		buildPath: "/",
		customGitBuildPath: null,
		dockerfile: null,
		env: null,
		cleanCache: false,
		railpackVersion: "0.2.0",
		serverId: null,
		buildServerId: null,
		environment: { env: "", project: { env: "" } },
		...overrides,
	}) as never;

describe("getRailpackCommand", () => {
	it("prepares a plan then builds via buildx with the pinned frontend version", () => {
		const cmd = getRailpackCommand(baseApp());
		expect(cmd).toContain("export RAILPACK_VERSION=0.2.0");
		expect(cmd).toContain("railpack prepare");
		expect(cmd).toContain("--plan-out");
		expect(cmd).toContain(
			"BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend:v0.2.0",
		);
		expect(cmd).toContain("docker buildx build");
		expect(cmd).toContain("--output type=docker,name=test-app");
		expect(cmd).toContain("❌ Railpack prepare failed");
		expect(cmd).toContain("✅ Railpack build completed.");
		// Cleans up the throwaway buildx builder.
		expect(cmd).toContain("docker buildx rm builder-containerd");
	});

	it("adds a cache-key + secrets-hash build-arg only when cleanCache is set", () => {
		expect(getRailpackCommand(baseApp({ cleanCache: true }))).toContain(
			"cache-key=CACHEKEY99",
		);
		const clean = getRailpackCommand(baseApp({ cleanCache: true }));
		expect(clean).toContain("secrets-hash=");
		expect(getRailpackCommand(baseApp())).not.toContain("cache-key=");
	});

	it("registers each env var as a buildx secret and exports it shell-quoted", () => {
		const cmd = getRailpackCommand(baseApp({ env: "TOKEN=a b" }));
		expect(cmd).toContain("--secret id=TOKEN,env=TOKEN");
		// The exported value (with a space) must be shell-quoted.
		expect(cmd).toContain("export TOKEN='a b'");
	});
});
