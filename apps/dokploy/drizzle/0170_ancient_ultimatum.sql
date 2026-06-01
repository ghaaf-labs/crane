ALTER TABLE "user" ADD COLUMN "is_instance_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Crane: seed the single instance owner (root) = the earliest-created user.
-- Self-host has no instance-admin role distinct from per-org owner, so the user
-- who first set up the instance becomes the instance admin. Idempotent: only
-- promotes a user if none is already flagged. The unique index in 0171 enforces
-- at most one true value going forward.
UPDATE "user" SET "is_instance_admin" = true
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE "is_instance_admin" = true)
  AND "id" = (
    SELECT "id" FROM "user"
    ORDER BY "created_at" ASC NULLS LAST, "id" ASC
    LIMIT 1
  );
