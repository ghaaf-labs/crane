import { db } from "@crane/server/db";
import {
	applications,
	compose,
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
} from "@crane/server/db/schema";
import { eq } from "drizzle-orm";
import { isInstanceAdmin } from "./user";

/**
 * The reserved appName used to stream host-machine stats (whole-server CPU /
 * memory / load / swap / per-core / disk) instead of a single container. Host
 * metrics are instance-wide, so they are reachable only by the instance owner
 * (the Admin section), never from an organization's monitoring view.
 */
export const HOST_MONITORING_APP_NAME = "dokploy";

export type MonitoringServiceType =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "libsql";

/** The `appType` the docker-stats stream expects for a given service kind. */
export type MonitoringAppType = "application" | "stack" | "docker-compose";

export interface OrgServiceTarget {
	appName: string;
	appType: MonitoringAppType;
	name: string;
	type: MonitoringServiceType;
	projectId: string;
	projectName: string;
	environmentId: string;
	environmentName: string;
	organizationId: string;
	organizationName: string;
}

/**
 * Resolves a globally-unique service `appName` to the id of the organization
 * that owns it, by walking service → environment → project → organization.
 * Returns null for the host sentinel or any appName that maps to no service
 * (e.g. a stale/guessed name). This is the authorization anchor for monitoring:
 * appName alone is enough because appNames are unique across all service tables.
 */
export const findOrganizationIdByAppName = async (
	appName: string,
): Promise<string | null> => {
	if (!appName || appName === HOST_MONITORING_APP_NAME) {
		return null;
	}
	const envs = await db.query.environments.findMany({
		with: {
			project: { columns: { organizationId: true } },
			applications: {
				where: eq(applications.appName, appName),
				columns: { applicationId: true },
			},
			compose: {
				where: eq(compose.appName, appName),
				columns: { composeId: true },
			},
			libsql: {
				where: eq(libsql.appName, appName),
				columns: { libsqlId: true },
			},
			mariadb: {
				where: eq(mariadb.appName, appName),
				columns: { mariadbId: true },
			},
			mongo: { where: eq(mongo.appName, appName), columns: { mongoId: true } },
			mysql: { where: eq(mysql.appName, appName), columns: { mysqlId: true } },
			postgres: {
				where: eq(postgres.appName, appName),
				columns: { postgresId: true },
			},
			redis: { where: eq(redis.appName, appName), columns: { redisId: true } },
		},
	});

	const match = envs.find(
		(env) =>
			env.applications.length > 0 ||
			env.compose.length > 0 ||
			env.libsql.length > 0 ||
			env.mariadb.length > 0 ||
			env.mongo.length > 0 ||
			env.mysql.length > 0 ||
			env.postgres.length > 0 ||
			env.redis.length > 0,
	);

	return match?.project?.organizationId ?? null;
};

/**
 * Authorization check for monitoring a single container/service by appName.
 *
 * - The instance owner (root) may monitor anything, including the host sentinel.
 * - Host metrics (the `dokploy` sentinel) are instance-owner-only.
 * - Any other caller may only monitor an appName whose owning organization is
 *   their active organization. This closes the tenant-isolation hole where an
 *   authenticated user could stream any organization's container stats by
 *   passing an arbitrary appName.
 */
export const canAccessAppMonitoring = async (opts: {
	userId: string;
	organizationId: string | null | undefined;
	appName: string;
}): Promise<boolean> => {
	if (await isInstanceAdmin(opts.userId)) {
		return true;
	}
	if (opts.appName === HOST_MONITORING_APP_NAME) {
		return false;
	}
	if (!opts.organizationId) {
		return false;
	}
	const ownerOrgId = await findOrganizationIdByAppName(opts.appName);
	return ownerOrgId !== null && ownerOrgId === opts.organizationId;
};

const composeAppType = (composeType: string | null): MonitoringAppType =>
	composeType === "stack" ? "stack" : "docker-compose";

const SERVICE_LISTING_WITH = {
	project: {
		columns: { projectId: true, name: true, organizationId: true },
		with: { organization: { columns: { name: true } } },
	},
	applications: { columns: { appName: true, name: true } },
	compose: { columns: { appName: true, name: true, composeType: true } },
	libsql: { columns: { appName: true, name: true } },
	mariadb: { columns: { appName: true, name: true } },
	mongo: { columns: { appName: true, name: true } },
	mysql: { columns: { appName: true, name: true } },
	postgres: { columns: { appName: true, name: true } },
	redis: { columns: { appName: true, name: true } },
} as const;

type ServiceRow = { appName: string; name: string };

// Maps one environment's services (applications, compose, databases) into the
// flat monitoring-target shape. Returns [] if the environment's project/org is
// not loaded (defensive against orphaned rows).
const mapEnvironmentServices = (env: {
	environmentId: string;
	name: string;
	project: {
		projectId: string;
		name: string;
		organizationId: string;
		organization: { name: string } | null;
	} | null;
	applications: ServiceRow[];
	compose: (ServiceRow & { composeType: string | null })[];
	libsql: ServiceRow[];
	mariadb: ServiceRow[];
	mongo: ServiceRow[];
	mysql: ServiceRow[];
	postgres: ServiceRow[];
	redis: ServiceRow[];
}): OrgServiceTarget[] => {
	if (!env.project) {
		return [];
	}
	const base = {
		projectId: env.project.projectId,
		projectName: env.project.name,
		environmentId: env.environmentId,
		environmentName: env.name,
		organizationId: env.project.organizationId,
		organizationName: env.project.organization?.name ?? "",
	};
	const out: OrgServiceTarget[] = [];
	for (const a of env.applications) {
		out.push({
			...base,
			appName: a.appName,
			appType: "application",
			name: a.name,
			type: "application",
		});
	}
	for (const c of env.compose) {
		out.push({
			...base,
			appName: c.appName,
			appType: composeAppType(c.composeType),
			name: c.name,
			type: "compose",
		});
	}
	const databases: [MonitoringServiceType, ServiceRow[]][] = [
		["postgres", env.postgres],
		["mysql", env.mysql],
		["mariadb", env.mariadb],
		["mongo", env.mongo],
		["redis", env.redis],
		["libsql", env.libsql],
	];
	for (const [type, rows] of databases) {
		for (const row of rows) {
			// Databases deploy as swarm services, monitored by the service label.
			out.push({
				...base,
				appName: row.appName,
				appType: "application",
				name: row.name,
				type,
			});
		}
	}
	return out;
};

const byProjectThenName = (a: OrgServiceTarget, b: OrgServiceTarget) =>
	a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name);

/**
 * Lists every deployable service in an organization, with the appName/appType
 * needed to open its monitoring stream. Used by the organization-scoped
 * monitoring view, which shows only the org's own services (never host metrics).
 */
export const listOrgServices = async (
	organizationId: string,
): Promise<OrgServiceTarget[]> => {
	const envs = await db.query.environments.findMany({
		with: SERVICE_LISTING_WITH,
	});
	return envs
		.flatMap(mapEnvironmentServices)
		.filter((s) => s.organizationId === organizationId)
		.sort(byProjectThenName);
};

/**
 * Lists every deployable service across ALL organizations (with org name). Used
 * by the instance-wide Admin monitoring view; must be gated to the instance
 * owner by the caller.
 */
export const listAllServices = async (): Promise<OrgServiceTarget[]> => {
	const envs = await db.query.environments.findMany({
		with: SERVICE_LISTING_WITH,
	});
	return envs
		.flatMap(mapEnvironmentServices)
		.sort(
			(a, b) =>
				a.organizationName.localeCompare(b.organizationName) ||
				byProjectThenName(a, b),
		);
};
