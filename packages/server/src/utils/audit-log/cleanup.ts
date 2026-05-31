import { deleteAuditLogsOlderThan } from "@crane/server/services/audit-log";
import { scheduledJobs, scheduleJob } from "node-schedule";

const AUDIT_LOG_CLEANUP_JOB_NAME = "audit-log-cleanup";

/**
 * Computes the retention cutoff: entries created before this instant are
 * eligible for deletion. Pure and timezone-agnostic (operates on epoch ms).
 */
export const auditLogCutoffDate = (now: Date, retentionDays: number): Date =>
	new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

/**
 * Optionally schedules a daily job that prunes audit-log entries older than
 * `retentionDays`. Retention is OPT-IN: a non-positive (or non-finite) value
 * disables it and schedules nothing, so the audit trail is never silently
 * truncated unless an operator asks for it (e.g. via AUDIT_LOG_RETENTION_DAYS).
 *
 * Returns true if a job was (re)scheduled, false if retention is disabled.
 */
export const startAuditLogCleanup = (
	retentionDays: number,
	cronExpression = "0 0 * * *",
): boolean => {
	const existingJob = scheduledJobs[AUDIT_LOG_CLEANUP_JOB_NAME];
	if (existingJob) {
		existingJob.cancel();
	}

	// Defense in depth: only a positive, safe integer enables a destructive job.
	if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
		return false;
	}

	scheduleJob(AUDIT_LOG_CLEANUP_JOB_NAME, cronExpression, async () => {
		try {
			const cutoff = auditLogCutoffDate(new Date(), retentionDays);
			const removed = await deleteAuditLogsOlderThan(cutoff);
			if (removed > 0) {
				console.log(
					`[audit-log] retention: removed ${removed} entries older than ${cutoff.toISOString()}`,
				);
			}
		} catch (error) {
			console.error("[audit-log] retention cleanup error:", error);
		}
	});

	return true;
};

/** Cancels the retention job if one is scheduled. */
export const stopAuditLogCleanup = (): void => {
	const existingJob = scheduledJobs[AUDIT_LOG_CLEANUP_JOB_NAME];
	if (existingJob) {
		existingJob.cancel();
	}
};
