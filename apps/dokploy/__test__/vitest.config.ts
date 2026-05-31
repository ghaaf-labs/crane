import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["__test__/**/*.test.ts"], // Incluir solo los archivos de test en el directorio __test__
		// *.real.test.ts are real-Docker/Swarm integration tests; keep them out of
		// the default unit run (and CI) — invoke them explicitly when a Docker
		// daemon + swarm are available.
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.docker/**",
			"**/*.real.test.ts",
		],
		pool: "forks",
		setupFiles: [path.resolve(__dirname, "setup.ts")],
	},
	define: {
		"process.env": {
			NODE: "test",
		},
	},
	plugins: [
		tsconfigPaths({
			projects: [path.resolve(__dirname, "../tsconfig.json")],
		}),
	],
	resolve: {
		alias: {
			"@crane/server": path.resolve(__dirname, "../../../packages/server/src"),
		},
	},
});
