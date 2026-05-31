import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * deleteAuditLogsOlderThan prunes in bounded batches so a first run on a large
 * table never materializes every removed id at once. These tests pin loop
 * termination and the accumulated count using a mocked drizzle db.
 */

const rows = (n: number, prefix: string) =>
	Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

let batches: Array<Array<{ id: string }>> = [];
let selectIndex = 0;

const limit = vi.fn(() => Promise.resolve(batches[selectIndex++] ?? []));
const selectWhere = vi.fn(() => ({ limit }));
const from = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from }));
const deleteWhere = vi.fn(() => Promise.resolve(undefined));
const del = vi.fn(() => ({ where: deleteWhere }));

vi.mock("@crane/server/db", () => ({
	db: { select, delete: del },
}));

const { deleteAuditLogsOlderThan } = await import(
	"@crane/server/services/audit-log"
);

beforeEach(() => {
	vi.clearAllMocks();
	selectIndex = 0;
	batches = [];
});

describe("deleteAuditLogsOlderThan", () => {
	it("returns 0 and issues no delete when nothing is old enough", async () => {
		batches = [[]];
		const removed = await deleteAuditLogsOlderThan(new Date(), 5000);
		expect(removed).toBe(0);
		expect(del).not.toHaveBeenCalled();
	});

	it("stops after a single partial batch", async () => {
		batches = [rows(10, "a")];
		const removed = await deleteAuditLogsOlderThan(new Date(), 5000);
		expect(removed).toBe(10);
		expect(select).toHaveBeenCalledTimes(1);
		expect(del).toHaveBeenCalledTimes(1);
	});

	it("loops across full batches and accumulates the count", async () => {
		// one full batch (continue) then a partial batch (stop)
		batches = [rows(5000, "a"), rows(10, "b")];
		const removed = await deleteAuditLogsOlderThan(new Date(), 5000);
		expect(removed).toBe(5010);
		expect(select).toHaveBeenCalledTimes(2);
		expect(del).toHaveBeenCalledTimes(2);
	});

	it("terminates when a full batch is followed by an empty one", async () => {
		batches = [rows(5000, "a"), []];
		const removed = await deleteAuditLogsOlderThan(new Date(), 5000);
		expect(removed).toBe(5000);
		expect(select).toHaveBeenCalledTimes(2);
		expect(del).toHaveBeenCalledTimes(1);
	});
});
