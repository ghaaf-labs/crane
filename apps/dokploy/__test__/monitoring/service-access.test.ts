import { beforeEach, describe, expect, it, vi } from "vitest";

// Crane: tenant-isolation tests for monitoring access. These guard the rule that
// a non-owner can only monitor appNames in their active organization, host
// metrics are instance-owner-only, and the instance owner can monitor anything.

let userRow: { isInstanceAdmin: boolean } | undefined;
let isCloud = false;
// One slot per service table, in the order the resolver queries them:
// applications, compose, postgres, mysql, mariadb, mongo, redis, libsql.
let serviceEnvIds: (string | undefined)[];
// The org id returned when resolving an environmentId → project → org.
let resolvedOrgId: string | null;
// Rows returned by environments.findMany (for listOrgServices).
let listEnvs: unknown[];

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

vi.mock("@crane/server/db", () => {
	const serviceTable = (idx: number) => ({
		findFirst: vi.fn(() =>
			Promise.resolve(
				serviceEnvIds[idx] ? { environmentId: serviceEnvIds[idx] } : undefined,
			),
		),
	});
	return {
		db: {
			query: {
				user: { findFirst: vi.fn(() => Promise.resolve(userRow)) },
				applications: serviceTable(0),
				compose: serviceTable(1),
				postgres: serviceTable(2),
				mysql: serviceTable(3),
				mariadb: serviceTable(4),
				mongo: serviceTable(5),
				redis: serviceTable(6),
				libsql: serviceTable(7),
				environments: {
					findFirst: vi.fn(() =>
						Promise.resolve(
							resolvedOrgId
								? { project: { organizationId: resolvedOrgId } }
								: undefined,
						),
					),
					findMany: vi.fn(() => Promise.resolve(listEnvs)),
				},
			},
		},
	};
});

const { canAccessAppMonitoring, findOrganizationIdByAppName, listOrgServices } =
	await import("@crane/server/services/monitoring");

// Sets up the resolver so `appName` is owned by `orgId` via one service table.
const ownedBy = (orgId: string, tableIndex = 0) => {
	serviceEnvIds[tableIndex] = "env-1";
	resolvedOrgId = orgId;
};

beforeEach(() => {
	vi.clearAllMocks();
	isCloud = false;
	userRow = { isInstanceAdmin: false };
	serviceEnvIds = [
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
	];
	resolvedOrgId = null;
	listEnvs = [];
});

describe("findOrganizationIdByAppName", () => {
	it("returns the owning org id when exactly one service matches", async () => {
		ownedBy("org-A");
		await expect(findOrganizationIdByAppName("app-foo")).resolves.toBe("org-A");
	});

	it("returns null for the host sentinel without querying", async () => {
		ownedBy("org-A");
		await expect(findOrganizationIdByAppName("dokploy")).resolves.toBeNull();
	});

	it("returns null when no service matches the appName", async () => {
		await expect(findOrganizationIdByAppName("ghost")).resolves.toBeNull();
	});

	it("fails closed when an appName matches more than one service", async () => {
		// Uniqueness violation across tables → denied (do not resolve an org).
		serviceEnvIds[0] = "env-1";
		serviceEnvIds[2] = "env-2";
		resolvedOrgId = "org-A";
		await expect(findOrganizationIdByAppName("dupe")).resolves.toBeNull();
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
		ownedBy("org-A");
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: "org-A",
				appName: "app-foo",
			}),
		).resolves.toBe(true);
	});

	it("DENIES a non-owner monitoring a service owned by another org", async () => {
		ownedBy("org-B");
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: "org-A",
				appName: "app-foo",
			}),
		).resolves.toBe(false);
	});

	it("denies when the caller has no active organization", async () => {
		ownedBy("org-A");
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: null,
				appName: "app-foo",
			}),
		).resolves.toBe(false);
	});

	it("denies an unknown appName", async () => {
		await expect(
			canAccessAppMonitoring({
				userId: "u",
				organizationId: "org-A",
				appName: "ghost",
			}),
		).resolves.toBe(false);
	});
});

describe("listOrgServices", () => {
	const envRow = (organizationId: string, appName: string) => ({
		environmentId: `env-${organizationId}`,
		name: "production",
		project: {
			projectId: `p-${organizationId}`,
			name: "Proj",
			organizationId,
			organization: { name: `Org ${organizationId}` },
		},
		applications: [{ appName, name: appName, applicationStatus: "running" }],
		compose: [],
		libsql: [],
		mariadb: [],
		mongo: [],
		mysql: [],
		postgres: [],
		redis: [],
	});

	it("returns only the active org's services with status, never another org's", async () => {
		listEnvs = [envRow("org-A", "app-a"), envRow("org-B", "app-b")];
		const services = await listOrgServices("org-A");
		expect(services).toHaveLength(1);
		expect(services[0]?.appName).toBe("app-a");
		expect(services[0]?.organizationId).toBe("org-A");
		expect(services[0]?.status).toBe("running");
	});

	it("returns an empty list for an org with no services", async () => {
		listEnvs = [envRow("org-B", "app-b")];
		await expect(listOrgServices("org-A")).resolves.toEqual([]);
	});
});
