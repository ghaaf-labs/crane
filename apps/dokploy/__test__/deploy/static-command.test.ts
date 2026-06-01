import { getStaticCommand } from "@crane/server/utils/builders/static";
import { describe, expect, it } from "vitest";

// Crane: characterization tests for the static-site (nginx) build assembly. The
// generated files are base64-encoded into the shell command, so we decode them
// back to assert the actual Dockerfile / nginx.conf content (golden behavior for
// the Rust port).

const baseApp = (overrides: Record<string, unknown> = {}) =>
	({
		applicationId: "app-id",
		name: "Static",
		appName: "test-app",
		sourceType: "git" as const,
		buildType: "static" as const,
		dockerfile: null,
		dockerContextPath: null,
		buildPath: "/",
		customGitBuildPath: null,
		publishDirectory: null,
		isStaticSpa: false,
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

// Extract + decode the base64-encoded content written to a file whose path ends
// with `suffix` (the command shape is: echo "<b64>" | base64 -d > "<path>").
const decodeFile = (command: string, suffix: string): string | null => {
	const re = /echo "([A-Za-z0-9+/=]+)" \| base64 -d > "([^"]+)"/g;
	let match: RegExpExecArray | null = re.exec(command);
	while (match !== null) {
		if (match[2]?.endsWith(suffix)) {
			return Buffer.from(match[1] as string, "base64").toString("utf8");
		}
		match = re.exec(command);
	}
	return null;
};

describe("getStaticCommand", () => {
	it("generates an nginx Dockerfile and ends with the docker build", () => {
		const cmd = getStaticCommand(baseApp());
		const dockerfile = decodeFile(cmd, "Dockerfile");
		expect(dockerfile).toContain("FROM nginx:alpine");
		expect(dockerfile).toContain("WORKDIR /usr/share/nginx/html/");
		expect(dockerfile).toContain('CMD ["nginx", "-g", "daemon off;"]');
		expect(cmd).toContain("docker build -t test-app");
	});

	it("copies the publish directory (defaulting to '.')", () => {
		expect(decodeFile(getStaticCommand(baseApp()), "Dockerfile")).toContain(
			"COPY . .",
		);
		expect(
			decodeFile(
				getStaticCommand(baseApp({ publishDirectory: "dist" })),
				"Dockerfile",
			),
		).toContain("COPY dist .");
	});

	it("writes a .dockerignore excluding secrets/build files", () => {
		const ignore = decodeFile(getStaticCommand(baseApp()), ".dockerignore");
		expect(ignore).toContain(".env");
		expect(ignore).toContain("Dockerfile");
	});

	it("does NOT add nginx.conf for a non-SPA static site", () => {
		const cmd = getStaticCommand(baseApp());
		expect(decodeFile(cmd, "nginx.conf")).toBeNull();
		expect(decodeFile(cmd, "Dockerfile")).not.toContain("COPY nginx.conf");
	});

	it("adds an SPA nginx.conf (try_files fallback) and copies it in", () => {
		const cmd = getStaticCommand(baseApp({ isStaticSpa: true }));
		const nginx = decodeFile(cmd, "nginx.conf");
		expect(nginx).toContain("try_files $uri $uri/ /index.html;");
		expect(nginx).toContain("listen 80;");
		expect(decodeFile(cmd, "Dockerfile")).toContain(
			"COPY nginx.conf /etc/nginx/nginx.conf",
		);
	});
});
