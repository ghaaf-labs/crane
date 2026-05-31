import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit-log retention is opt-in. These tests pin the safety-critical behaviour:
 * a non-positive / non-finite retention schedules NOTHING (the trail is never
 * silently truncated), a positive value schedules a daily prune, and the
 * scheduled callback deletes entries older than the computed cutoff.
 */

const scheduleJob =
	vi.fn<(name: string, cron: string, cb: () => Promise<void>) => void>();
const scheduledJobs: Record<string, { cancel: () => void }> = {};
const deleteAuditLogsOlderThan = vi.fn<(before: Date) => Promise<number>>(() =>
	Promise.resolve(3),
);

vi.mock("node-schedule", () => ({ scheduleJob, scheduledJobs }));
vi.mock("@crane/server/services/audit-log", () => ({
	deleteAuditLogsOlderThan,
}));

const { auditLogCutoffDate, startAuditLogCleanup, stopAuditLogCleanup } =
	await import("@crane/server/utils/audit-log/cleanup");

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(scheduledJobs)) delete scheduledJobs[key];
});

describe("auditLogCutoffDate", () => {
	it("subtracts the retention window in days", () => {
		const now = new Date("2026-06-01T00:00:00.000Z");
		expect(auditLogCutoffDate(now, 30).toISOString()).toBe(
			"2026-05-02T00:00:00.000Z",
		);
		expect(auditLogCutoffDate(now, 1).toISOString()).toBe(
			"2026-05-31T00:00:00.000Z",
		);
	});
});

describe("startAuditLogCleanup (opt-in guard)", () => {
	it("schedules nothing for 0, negative, non-finite, or fractional retention", () => {
		expect(startAuditLogCleanup(0)).toBe(false);
		expect(startAuditLogCleanup(-5)).toBe(false);
		expect(startAuditLogCleanup(Number.NaN)).toBe(false);
		expect(startAuditLogCleanup(Number.POSITIVE_INFINITY)).toBe(false);
		// only safe integers enable a destructive job (defense in depth)
		expect(startAuditLogCleanup(1.5)).toBe(false);
		expect(scheduleJob).not.toHaveBeenCalled();
	});

	it("schedules a daily job for a positive retention", () => {
		expect(startAuditLogCleanup(30)).toBe(true);
		expect(scheduleJob).toHaveBeenCalledTimes(1);
		const call = scheduleJob.mock.calls[0];
		expect(call?.[0]).toBe("audit-log-cleanup");
		expect(call?.[1]).toBe("0 0 * * *");
	});

	it("accepts a custom cron expression", () => {
		startAuditLogCleanup(7, "0 3 * * 0");
		expect(scheduleJob.mock.calls[0]?.[1]).toBe("0 3 * * 0");
	});

	it("cancels an existing job before rescheduling", () => {
		const cancel = vi.fn();
		scheduledJobs["audit-log-cleanup"] = { cancel };
		startAuditLogCleanup(30);
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("deletes entries older than the cutoff when the job fires", async () => {
		startAuditLogCleanup(30);
		const job = scheduleJob.mock.calls[0]?.[2];
		expect(job).toBeDefined();
		await job?.();
		expect(deleteAuditLogsOlderThan).toHaveBeenCalledTimes(1);
		const cutoff = deleteAuditLogsOlderThan.mock.calls[0]?.[0];
		expect(cutoff).toBeInstanceOf(Date);
		// roughly 30 days before now (allow generous slack for test runtime)
		const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
		expect(Math.abs((cutoff as Date).getTime() - expectedMs)).toBeLessThan(
			60_000,
		);
	});
});

describe("stopAuditLogCleanup", () => {
	it("cancels a scheduled job if present", () => {
		const cancel = vi.fn();
		scheduledJobs["audit-log-cleanup"] = { cancel };
		stopAuditLogCleanup();
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("is a no-op when nothing is scheduled", () => {
		expect(() => stopAuditLogCleanup()).not.toThrow();
	});
});
