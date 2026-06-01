/**
 * Single source of truth for audit actions/resource types.
 *
 * This module is deliberately DEPENDENCY-FREE (no drizzle/schema/server imports)
 * so it is safe to import into client bundles. The audit-log viewer (a client
 * component) needs these arrays at runtime to build its filter dropdowns;
 * importing them from the schema barrel instead would drag server-only native
 * deps (dockerode → ssh2 → cpu-features) into the browser bundle and break the
 * build. The derived union types feed the typing layer; the const arrays feed
 * runtime validation (the tRPC reader's zod enums) so the two can never drift.
 */
export const auditActions = [
	"create",
	"update",
	"delete",
	"deploy",
	"cancel",
	"redeploy",
	"login",
	"logout",
	"restore",
	"run",
	"start",
	"stop",
	"reload",
	"rebuild",
	"move",
] as const;

export const auditResourceTypes = [
	"project",
	"service",
	"environment",
	"deployment",
	"user",
	"customRole",
	"domain",
	"certificate",
	"registry",
	"server",
	"sshKey",
	"gitProvider",
	"destination",
	"notification",
	"settings",
	"session",
	"port",
	"redirect",
	"security",
	"schedule",
	"backup",
	"volumeBackup",
	"docker",
	"swarm",
	"previewDeployment",
	"organization",
	"cluster",
	"mount",
	"application",
	"compose",
	"ai",
	"tag",
] as const;

export type AuditAction = (typeof auditActions)[number];

export type AuditResourceType = (typeof auditResourceTypes)[number];
