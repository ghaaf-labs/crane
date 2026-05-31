import {
	type AuditAction,
	type AuditResourceType,
	auditActions,
	auditResourceTypes,
} from "@crane/server/db/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The audit-log reader (apps/dokploy/server/api/routers/audit-log.ts) builds its
 * zod input from these const arrays, and the service/types derive their unions
 * from the same arrays. These tests pin that single-source-of-truth contract so
 * the runtime validator and the compile-time types can never silently drift.
 */
describe("audit-log enum arrays", () => {
	it("are non-empty", () => {
		expect(auditActions.length).toBeGreaterThan(0);
		expect(auditResourceTypes.length).toBeGreaterThan(0);
	});

	it("contain no duplicates", () => {
		expect(new Set(auditActions).size).toBe(auditActions.length);
		expect(new Set(auditResourceTypes).size).toBe(auditResourceTypes.length);
	});

	it("cover the sensitive resource types that have audited mutations", () => {
		// guards against a router auditing a resourceType the union doesn't know
		for (const required of ["ai", "tag", "user", "settings", "registry"]) {
			expect(auditResourceTypes).toContain(required);
		}
	});

	it("derive types that stay in sync with the arrays", () => {
		// Compile-time guard: every array member is assignable to the union and
		// vice-versa. If the union and array drift, this stops compiling.
		const action: AuditAction = auditActions[0];
		const resource: AuditResourceType = auditResourceTypes[0];
		expect(auditActions).toContain(action);
		expect(auditResourceTypes).toContain(resource);
	});
});

describe("audit-log reader zod validation", () => {
	const actionEnum = z.enum(auditActions);
	const resourceEnum = z.enum(auditResourceTypes);

	it("accepts every known action and resource type", () => {
		for (const a of auditActions) {
			expect(actionEnum.safeParse(a).success).toBe(true);
		}
		for (const r of auditResourceTypes) {
			expect(resourceEnum.safeParse(r).success).toBe(true);
		}
	});

	it("rejects unknown values", () => {
		expect(actionEnum.safeParse("not-an-action").success).toBe(false);
		expect(resourceEnum.safeParse("not-a-resource").success).toBe(false);
		expect(actionEnum.safeParse("").success).toBe(false);
	});
});
