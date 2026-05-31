import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization + org-scoping contract for the audit-log reader.
 *
 * The router uses `adminProcedure` (owner/admin only) — deliberately NOT
 * `withPermission("auditLog","read")`, which would be bypassed (granted) for
 * static roles incl. plain members because `auditLog` is enterprise-only. These
 * tests pin both invariants: members/anon are rejected, and every read is
 * scoped to the caller's active organization.
 */

const getAuditLogs = vi.fn(() => Promise.resolve({ logs: [], total: 0 }));

// Keep module load light: trpc.ts pulls in db + auth, which we don't exercise.
vi.mock("@crane/server/db", () => ({ db: {} }));
vi.mock("@crane/server/lib/auth", () => ({ validateRequest: vi.fn() }));
vi.mock("@crane/server/services/audit-log", () => ({ getAuditLogs }));

const { auditLogRouter } = await import("../../server/api/routers/audit-log");
const { createTRPCRouter } = await import("../../server/api/trpc");

const router = createTRPCRouter({ auditLog: auditLogRouter });

const makeCtx = (
	role: "owner" | "admin" | "member" | null,
	organizationId = "org-1",
) => ({
	db: {} as any,
	req: {} as any,
	res: {} as any,
	session: role ? ({ activeOrganizationId: organizationId } as any) : null,
	user: role ? ({ id: "user-1", email: "test@test.com", role } as any) : null,
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe("auditLog.all authorization", () => {
	it("allows an owner and scopes the query to their organization", async () => {
		const caller = router.createCaller(makeCtx("owner", "org-A") as any);
		await caller.auditLog.all({});
		expect(getAuditLogs).toHaveBeenCalledTimes(1);
		expect(getAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-A" }),
		);
	});

	it("allows an admin and scopes the query to their organization", async () => {
		const caller = router.createCaller(makeCtx("admin", "org-B") as any);
		await caller.auditLog.all({});
		expect(getAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-B" }),
		);
	});

	it("rejects a plain member (UNAUTHORIZED) and never reads logs", async () => {
		const caller = router.createCaller(makeCtx("member") as any);
		await expect(caller.auditLog.all({})).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(getAuditLogs).not.toHaveBeenCalled();
	});

	it("rejects an unauthenticated caller", async () => {
		const caller = router.createCaller(makeCtx(null) as any);
		await expect(caller.auditLog.all({})).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(getAuditLogs).not.toHaveBeenCalled();
	});
});

describe("auditLog.all input handling", () => {
	it("forwards validated filters through to the service", async () => {
		const caller = router.createCaller(makeCtx("admin", "org-C") as any);
		await caller.auditLog.all({
			action: "deploy",
			resourceType: "application",
			userEmail: "someone@example.com",
			limit: 25,
			offset: 50,
		});
		expect(getAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-C",
				action: "deploy",
				resourceType: "application",
				userEmail: "someone@example.com",
				limit: 25,
				offset: 50,
			}),
		);
	});

	it("rejects an unknown action via zod", async () => {
		const caller = router.createCaller(makeCtx("admin") as any);
		await expect(
			// @ts-expect-error invalid action is rejected at runtime by zod
			caller.auditLog.all({ action: "obliterate" }),
		).rejects.toBeDefined();
		expect(getAuditLogs).not.toHaveBeenCalled();
	});

	it("rejects an out-of-range limit via zod", async () => {
		const caller = router.createCaller(makeCtx("admin") as any);
		await expect(caller.auditLog.all({ limit: 9999 })).rejects.toBeDefined();
		expect(getAuditLogs).not.toHaveBeenCalled();
	});
});
