import type { AuditLog } from "@crane/server/db/schema";
import { auditLogsToCsv } from "@crane/server/services/audit-log";
import { describe, expect, it } from "vitest";

const row = (overrides: Partial<AuditLog>): AuditLog =>
	({
		id: "1",
		organizationId: "org-1",
		userId: "u1",
		userEmail: "a@b.c",
		userRole: "admin",
		action: "create",
		resourceType: "project",
		resourceId: "r1",
		resourceName: "my-app",
		metadata: null,
		createdAt: new Date("2026-06-01T12:00:00.000Z"),
		...overrides,
	}) as AuditLog;

describe("auditLogsToCsv", () => {
	it("emits a header row even with no entries", () => {
		const csv = auditLogsToCsv([]);
		expect(csv).toBe(
			"createdAt,userEmail,userRole,action,resourceType,resourceName,resourceId,metadata",
		);
	});

	it("serializes a row with ISO timestamp and CRLF separator", () => {
		const csv = auditLogsToCsv([row({})]);
		const lines = csv.split("\r\n");
		expect(lines).toHaveLength(2);
		expect(lines[1]).toBe(
			"2026-06-01T12:00:00.000Z,a@b.c,admin,create,project,my-app,r1,",
		);
	});

	it("quotes and escapes fields containing commas, quotes, or newlines", () => {
		const csv = auditLogsToCsv([
			row({
				resourceName: "name, with comma",
				metadata: '{"k":"a\nb"}',
				userEmail: 'has"quote',
			}),
		]);
		const dataLine = csv.split("\r\n")[1] ?? "";
		expect(dataLine).toContain('"name, with comma"');
		expect(dataLine).toContain('"{""k"":""a\nb""}"'); // doubled quotes
		expect(dataLine).toContain('"has""quote"');
	});

	it("renders null resourceName/resourceId/metadata as empty fields", () => {
		const csv = auditLogsToCsv([
			row({ resourceName: null, resourceId: null, metadata: null }),
		]);
		expect(csv.split("\r\n")[1]).toBe(
			"2026-06-01T12:00:00.000Z,a@b.c,admin,create,project,,,",
		);
	});

	it("neutralizes spreadsheet formula injection in user-controlled fields", () => {
		const csv = auditLogsToCsv([
			row({ resourceName: "=cmd|'/c calc'!A1", metadata: "+1+1" }),
		]);
		const dataLine = csv.split("\r\n")[1] ?? "";
		// leading =,+ get a single-quote prefix; the = field also gets RFC quoting
		// because the value would otherwise be misread — confirm both are prefixed
		expect(dataLine).toContain("'=cmd");
		expect(dataLine).toContain("'+1+1");
		expect(dataLine).not.toMatch(/,=cmd/);
		expect(dataLine).not.toMatch(/,\+1\+1/);
	});

	it("leaves a non-leading @ or - untouched", () => {
		const csv = auditLogsToCsv([
			row({ userEmail: "a@b.c", resourceName: "x-1" }),
		]);
		const dataLine = csv.split("\r\n")[1] ?? "";
		expect(dataLine).toContain("a@b.c"); // @ not at start → no prefix
		expect(dataLine).toContain("x-1"); // - not at start → no prefix
	});

	it("tolerates a string createdAt (defensive)", () => {
		const csv = auditLogsToCsv([
			row({ createdAt: "2026-06-01T12:00:00.000Z" as unknown as Date }),
		]);
		expect(csv.split("\r\n")[1]).toContain("2026-06-01T12:00:00.000Z");
	});
});
