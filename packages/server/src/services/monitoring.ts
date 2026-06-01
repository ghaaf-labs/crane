import { db } from "@crane/server/db";
import {
	applications,
	compose,
	environments,
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

/** Deploy status shared by every service table (compose stores it as composeStatus). */
export type ServiceStatus = "idle" | "running" | "done" | "error";

export interface OrgServiceTarget {
	appName: string;
	appType: MonitoringAppType;
	name: string;
	type: MonitoringServiceType;
	status: ServiceStatus;
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
 * (e.g. a stale/guessed name). This is the authorization anchor for monitoring,
 * so it runs on every WebSocket connect and monitoring read: it does targeted,
 * indexed point-lookups on each service table's (unique) appName rather than
 * scanning all environments. Fails CLOSED — if an appName somehow matches more
 * than one service (a uniqueness violation), it is treated as unresolved.
 */
export const findOrganizationIdByAppName = async (
	appName: string,
): Promise<string | null> => {
	if (!appName || appName === HOST_MONITORING_APP_NAME) {
		return null;
	}

	const matches = await Promise.all([
		db.query.applications.findFirst({
			where: eq(applications.appName, appName),
			columns: { environmentId: true },
		}),
		db.query.compose.findFirst({
			where: eq(compose.appName, appName),
			columns: { environmentId: true },
		}),
		db.query.postgres.findFirst({
			where: eq(postgres.appName, appName),
			columns: { environmentId: true },
		}),
		db.query.mysql.findFirst({
			where: eq(mysql.appName, appName),
			columns: { environmentId: true },
		}),
		db.query.mariadb.findFirst({
			where: eq(mariadb.appName, appName),
			columns: { environmentId: true },
		}),
		db.query.mongo.findFirst({
			where: eq(mongo.appName, appName),
			columns: { environmentId: true },
		}),
		db.query.redis.findFirst({
			where: eq(redis.appName, appName),
			columns: { environmentId: true },
		}),
		db.query.libsql.findFirst({
			where: eq(libsql.appName, appName),
			columns: { environmentId: true },
		}),
	]);

	const environmentIds = matches
		.filter((row): row is { environmentId: string } => row != null)
		.map((row) => row.environmentId);
	// Exactly one service must own the appName. Zero = not found; more than one =
	// a uniqueness violation, denied defensively.
	if (environmentIds.length !== 1) {
		return null;
	}

	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentIds[0] as string),
		columns: {},
		with: { project: { columns: { organizationId: true } } },
	});

	return environment?.project?.organizationId ?? null;
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
	applications: {
		columns: { appName: true, name: true, applicationStatus: true },
	},
	compose: {
		columns: {
			appName: true,
			name: true,
			composeType: true,
			composeStatus: true,
		},
	},
	libsql: { columns: { appName: true, name: true, applicationStatus: true } },
	mariadb: { columns: { appName: true, name: true, applicationStatus: true } },
	mongo: { columns: { appName: true, name: true, applicationStatus: true } },
	mysql: { columns: { appName: true, name: true, applicationStatus: true } },
	postgres: { columns: { appName: true, name: true, applicationStatus: true } },
	redis: { columns: { appName: true, name: true, applicationStatus: true } },
} as const;

type ServiceRow = {
	appName: string;
	name: string;
	applicationStatus: ServiceStatus;
};

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
	compose: (Omit<ServiceRow, "applicationStatus"> & {
		composeType: string | null;
		composeStatus: ServiceStatus;
	})[];
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
			status: a.applicationStatus,
		});
	}
	for (const c of env.compose) {
		out.push({
			...base,
			appName: c.appName,
			appType: composeAppType(c.composeType),
			name: c.name,
			type: "compose",
			status: c.composeStatus,
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
				status: row.applicationStatus,
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
