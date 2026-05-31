import { db } from "@crane/server/db";
import type {
	AuditAction,
	AuditLog,
	AuditResourceType,
} from "@crane/server/db/schema";
import { auditLog } from "@crane/server/db/schema";
import { and, desc, eq, gte, ilike, inArray, lt, lte } from "drizzle-orm";

export type { AuditAction, AuditResourceType };

/**
 * Serializes audit-log rows to RFC-4180 CSV (CRLF rows, quoted/escaped fields).
 * Pure — used by the viewer's export so operators can pull the trail for
 * compliance/analysis. Timestamps are emitted as ISO-8601 UTC.
 */
export const auditLogsToCsv = (logs: AuditLog[]): string => {
	const header = [
		"createdAt",
		"userEmail",
		"userRole",
		"action",
		"resourceType",
		"resourceName",
		"resourceId",
		"metadata",
	];
	const escapeField = (value: unknown): string => {
		let s = value == null ? "" : String(value);
		// Neutralize spreadsheet formula injection: a field beginning with
		// = + - @ TAB or CR is executed as a formula by Excel/Sheets/LibreOffice.
		// resourceName/metadata are user-controllable, so prefix a single quote.
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const lines = logs.map((log) =>
		[
			log.createdAt instanceof Date
				? log.createdAt.toISOString()
				: String(log.createdAt ?? ""),
			log.userEmail,
			log.userRole,
			log.action,
			log.resourceType,
			log.resourceName ?? "",
			log.resourceId ?? "",
			log.metadata ?? "",
		]
			.map(escapeField)
			.join(","),
	);
	return [header.join(","), ...lines].join("\r\n");
};

export interface CreateAuditLogInput {
	organizationId: string;
	userId: string;
	userEmail: string;
	userRole: string;
	action: AuditAction;
	resourceType: AuditResourceType;
	resourceId?: string;
	resourceName?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Persists an audit-log entry. Fire-and-forget safe: any failure is logged and
 * swallowed so audit logging can never break the operation it is recording.
 *
 * Audit logging is an always-on, open feature in this fork (Apache-2.0). It is
 * not gated by any license check.
 */
export const createAuditLog = async (input: CreateAuditLogInput) => {
	try {
		await db.insert(auditLog).values({
			organizationId: input.organizationId,
			userId: input.userId,
			userEmail: input.userEmail,
			userRole: input.userRole,
			action: input.action,
			resourceType: input.resourceType,
			resourceId: input.resourceId,
			resourceName: input.resourceName,
			metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
		});
	} catch (err) {
		console.error("[audit-log] Failed to create audit log entry:", err);
	}
};

export interface GetAuditLogsInput {
	organizationId: string;
	userId?: string;
	userEmail?: string;
	resourceName?: string;
	action?: AuditAction;
	resourceType?: AuditResourceType;
	from?: Date;
	to?: Date;
	limit?: number;
	offset?: number;
}

/**
 * Reads audit-log entries for an organization with optional filtering and
 * pagination. Exposed for a future (Apache-licensed) audit viewer.
 */
export const getAuditLogs = async (input: GetAuditLogsInput) => {
	const {
		organizationId,
		userId,
		userEmail,
		resourceName,
		action,
		resourceType,
		from,
		to,
		limit = 50,
		offset = 0,
	} = input;

	const conditions = [eq(auditLog.organizationId, organizationId)];

	if (userId) conditions.push(eq(auditLog.userId, userId));
	if (userEmail) conditions.push(ilike(auditLog.userEmail, `%${userEmail}%`));
	if (resourceName)
		conditions.push(ilike(auditLog.resourceName, `%${resourceName}%`));
	if (action) conditions.push(eq(auditLog.action, action));
	if (resourceType) conditions.push(eq(auditLog.resourceType, resourceType));
	if (from) conditions.push(gte(auditLog.createdAt, from));
	if (to) conditions.push(lte(auditLog.createdAt, to));

	const [logs, total] = await Promise.all([
		db.query.auditLog.findMany({
			where: and(...conditions),
			orderBy: [desc(auditLog.createdAt)],
			limit,
			offset,
		}),
		db.$count(auditLog, and(...conditions)),
	]);

	return { logs, total };
};

/**
 * Deletes audit-log entries created strictly before `before`, returning the
 * number removed. Used by the optional retention job to bound table growth.
 * Retention is opt-in (see startAuditLogCleanup) precisely because audit trails
 * are often kept indefinitely for compliance.
 *
 * Deletes in bounded batches so a first prune of a very large table never
 * materializes every removed id in memory at once.
 */
export const deleteAuditLogsOlderThan = async (
	before: Date,
	batchSize = 5000,
): Promise<number> => {
	let totalDeleted = 0;
	while (true) {
		const batch = await db
			.select({ id: auditLog.id })
			.from(auditLog)
			.where(lt(auditLog.createdAt, before))
			.limit(batchSize);
		if (batch.length === 0) break;
		await db.delete(auditLog).where(
			inArray(
				auditLog.id,
				batch.map((row) => row.id),
			),
		);
		totalDeleted += batch.length;
		if (batch.length < batchSize) break;
	}
	return totalDeleted;
};
