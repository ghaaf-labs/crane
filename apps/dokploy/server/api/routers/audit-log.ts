import { auditActions, auditResourceTypes } from "@crane/server/db/schema";
import { getAuditLogs } from "@crane/server/services/audit-log";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, createTRPCRouter } from "../trpc";

/**
 * Audit-log reader. Open (Apache-2.0) in this fork — no license gate.
 *
 * Audit logs are organization-wide and expose every member's actions, so reads
 * are restricted to owners/admins via `adminProcedure`. We deliberately do NOT
 * use `withPermission("auditLog", "read")`: `auditLog` is an "enterprise-only"
 * resource, and for static roles that permission check is bypassed (granted) —
 * which would expose the log to plain members. Always scope queries to the
 * caller's active organization so one org can never read another's trail.
 */
export const auditLogRouter = createTRPCRouter({
	all: adminProcedure
		.input(
			z.object({
				userEmail: z.string().trim().max(255).optional(),
				resourceName: z.string().trim().max(255).optional(),
				action: z.enum(auditActions).optional(),
				resourceType: z.enum(auditResourceTypes).optional(),
				from: z.date().optional(),
				to: z.date().optional(),
				limit: z.number().int().min(1).max(200).default(50),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = ctx.session.activeOrganizationId;
			if (!organizationId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No active organization",
				});
			}

			return getAuditLogs({
				organizationId,
				userEmail: input.userEmail || undefined,
				resourceName: input.resourceName || undefined,
				action: input.action,
				resourceType: input.resourceType,
				from: input.from,
				to: input.to,
				limit: input.limit,
				offset: input.offset,
			});
		}),
});
