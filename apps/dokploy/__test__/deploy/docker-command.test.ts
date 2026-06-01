import { getDockerCommand } from "@crane/server/utils/builders/docker-file";
import { describe, expect, it } from "vitest";

// Crane: characterization tests for the Dockerfile build-command assembly — the
// byte-for-byte shell string AGENTS.md says to pin behind golden tests before the
// Rust port. Assertions target the stable structure (not the absolute build path,
// which depends on the deploy environment).

const baseApp = (overrides: Record<string, unknown> = {}) =>
	({
		applicationId: "app-id",
		name: "Test App",
		appName: "test-app",
		sourceType: "git" as const,
		buildType: "dockerfile" as const,
		dockerfile: "Dockerfile",
		dockerContextPath: null,
		buildPath: "/",
		customGitBuildPath: null,
		publishDirectory: null,
		env: null,
		buildArgs: null,
		buildSecrets: null,
		dockerBuildStage: null,
		cleanCache: false,
		createEnvFile: false,
		serverId: null,
		buildServerId: null,
		environment: { env: "", project: { env: "" } },
		...overrides,
	}) as never;

describe("getDockerCommand", () => {
	it("assembles a `docker build` tagged with the appName, with failure guards", () => {
		const cmd = getDockerCommand(baseApp());
		expect(cmd).toContain("docker build -t test-app -f");
		expect(cmd).toContain('echo "Building test-app"');
		expect(cmd).toContain("❌ Docker build failed");
		expect(cmd).toContain("✅ Docker build completed.");
	});

	it("adds --target for a build stage", () => {
		expect(getDockerCommand(baseApp({ dockerBuildStage: "prod" }))).toContain(
			"--target prod",
		);
		expect(getDockerCommand(baseApp())).not.toContain("--target");
	});

	it("adds --no-cache only when cleanCache is set", () => {
		expect(getDockerCommand(baseApp({ cleanCache: true }))).toContain(
			"--no-cache",
		);
		expect(getDockerCommand(baseApp())).not.toContain("--no-cache");
	});

	it("passes build args as --build-arg (shell-quoted)", () => {
		const cmd = getDockerCommand(baseApp({ buildArgs: "FOO=bar" }));
		// shell-quote defensively backslash-escapes the '=' (harmless to docker).
		expect(cmd).toContain("--build-arg FOO\\=bar");
	});

	it("declares build secrets as --secret type=env and shell-quotes the value", () => {
		const cmd = getDockerCommand(baseApp({ buildSecrets: "TOKEN=se cret" }));
		expect(cmd).toContain("--secret type=env,id=TOKEN");
		// The value (with a space) must be shell-quoted in the inline assignment
		// so it cannot be split or injected.
		expect(cmd).toContain("TOKEN='se cret'");
	});

	it("writes a .env file when createEnvFile is set and there is no publishDirectory", () => {
		const withEnv = getDockerCommand(
			baseApp({ createEnvFile: true, env: "A=B" }),
		);
		expect(withEnv).toContain(".env");
	});

	it("omits the .env file when a publishDirectory is set (avoid exposing secrets)", () => {
		const withPublish = getDockerCommand(
			baseApp({ createEnvFile: true, env: "A=B", publishDirectory: "dist" }),
		);
		expect(withPublish).not.toContain("cat >'");
	});
});
