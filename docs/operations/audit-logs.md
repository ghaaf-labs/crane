# Audit logs

Crane records an organization-wide audit trail of who did what — deployments,
resource create/update/delete, and sign-in/out — to the `audit_log` Postgres
table. Logging is **always on** and Apache-2.0 (no license gate); it is written
fire-and-forget so it can never break the operation it records.

## Viewing

Owners and admins can browse the trail at **Settings → Audit Logs**
(`/dashboard/settings/audit-logs`). The viewer supports filtering by user
email, resource name, action, and resource type, with pagination.

Access is restricted to owners/admins:

- The reader (`auditLog.all` tRPC procedure) uses `adminProcedure`. It is
  deliberately **not** gated with `withPermission("auditLog","read")` — because
  `auditLog` is an "enterprise-only" resource, that permission check is bypassed
  (granted) for static roles, which would expose the trail to plain members.
- Every query is scoped to the caller's active organization.

## Retention (opt-in)

By default the audit trail is **kept indefinitely** — audit logs are frequently
required for security/compliance, so Crane never auto-truncates them.

To bound table growth, set the `AUDIT_LOG_RETENTION_DAYS` environment variable
on the main app to a positive integer. On startup (production, non-cloud) a
daily job (`0 0 * * *`) then deletes entries older than that many days:

```bash
# keep ~90 days of audit history; older entries are pruned daily at 00:00
AUDIT_LOG_RETENTION_DAYS=90
```

A value of `0`, a negative number, an unset/empty value, or any non-integer
disables retention entirely and schedules nothing. The job logs how many
entries it removed on each run.

Implementation: `packages/server/src/utils/audit-log/cleanup.ts`
(`startAuditLogCleanup`, `auditLogCutoffDate`) and `deleteAuditLogsOlderThan` in
`packages/server/src/services/audit-log.ts`, wired from `initCronJobs`
(`packages/server/src/utils/backups/index.ts`).
