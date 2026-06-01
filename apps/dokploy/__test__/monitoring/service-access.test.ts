import { beforeEach, describe, expect, it, vi } from "vitest";

// Crane: tenant-isolation tests for monitoring access. These guard the rule that
// a non-owner can only monitor appNames in their active organization, host
// metrics are instance-owner-only, and the instance owner can monitor anything.

let userRow: { isInstanceAdmin: boolean } | undefined;
let envRows: unknown[];
let isCloud = false;

vi.mock("@crane/server/constants", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@crane/server/constants")>();
	return {
		...actual,
		get IS_CLOUD() {
			return isCloud;
		},
	};
});

vi.mock("@crane/server/db", () => ({
	db: {
		query: {
			user: { findFirst: vi.fn(() => Promise.resolve(userRow)) },
			environments: { findMany: vi.fn(() => Promise.resolve(envRows)) },
		},
	},
}));

const { canAccessAppMonitoring, findOrganizationIdByAppName } = await import(
	"@crane/server/services/monitoring"
);

// Builds an environment row as the relational query would return it after
// filtering each service relation by appName (matching rows present, rest empty).
const envWithApp = (organizationId: string) => ({
	environmentId: "env-1",
	name: "production",
	project: { projectId: "p1", name: "Proj", organizationId },
	applications: [{ applicationId: "a1" }],
	compose: [],
	libsql: [],
	mariadb: [],
	mongo: [],
	mysql: [],
	postgres: [],
	redis: [],
});

const emptyEnv = () => ({
	environmentId: "env-1",
	name: "production",
	project: { projectId: "p1", name: "Proj", organizationId: "org-A" },
	applications: [],
	compose: [],
	libsql: [],
	mariadb: [],
	mongo: [],
	mysql: [],
	postgres: [],
	redis: [],
});

beforeEach(() => {
	vi.clearAllMocks();
	isCloud = false;
	userRow = { isInstanceAdmin: false };
	envRows = [];
});

describe("findOrganizationIdByAppName", () => {
	it("returns the owning org id when a service matches", async () => {
		envRows = [envWithApp("org-A")];
		await expect(findOrganizationIdByAppName("app-foo")).resolves.toBe("org-A");
	});

	it("returns null for the host sentinel without querying", async () => {
		envRows = [envWithApp("org-A")];
		await expect(findOrganizationIdByAppName("dokploy")).resolves.toBeNull();
	});

	it("returns null when no service matches the appName", async () => {
		envRows = [emptyEnv()];
		await expect(findOrganizationIdByAppName("ghost")).resolves.toBeNull();
	});
});

describe("canAccessAppMonitoring", () => {
	it("lets the instance owner monitor anything, including the host", async () => {
		userRow = { isInstanceAdmin: true };
		await expect(
			canAccessAppMonitoring({
				userId: "root",
				organizationId: "org-A",
				appName: "dokploy",
			}),
		).resolves.toBe(true);
	});

	it("denies host metrics to a non-owner", async () => {
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: "org-A",
				appName: "dokploy",
			}),
		).resolves.toBe(false);
	});

	it("allows a non-owner to monitor a service in their active org", async () => {
		envRows = [envWithApp("org-A")];
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: "org-A",
				appName: "app-foo",
			}),
		).resolves.toBe(true);
	});

	it("DENIES a non-owner monitoring a service owned by another org", async () => {
		envRows = [envWithApp("org-B")];
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: "org-A",
				appName: "app-foo",
			}),
		).resolves.toBe(false);
	});

	it("denies when the caller has no active organization", async () => {
		envRows = [envWithApp("org-A")];
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: null,
				appName: "app-foo",
			}),
		).resolves.toBe(false);
	});

	it("denies an unknown appName", async () => {
		envRows = [emptyEnv()];
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: "org-A",
				appName: "ghost",
			}),
		).resolves.toBe(false);
	});
});
