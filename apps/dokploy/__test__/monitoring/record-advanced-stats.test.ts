import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Integration coverage for the free-tier persistence path: recordAdvancedStats
// (docker-stats string parsing) -> JSON files -> getAdvancedStats readback, plus
// the 288-entry rolling window. We point MONITORING_PATH at a real temp dir.
const TMP = mkdtempSync(join(tmpdir(), "crane-mon-"));

vi.mock("@crane/server/constants", () => ({
	paths: () => ({ MONITORING_PATH: TMP }),
}));

const { recordAdvancedStats, getAdvancedStats, getLastAdvancedStatsFile } =
	await import("@crane/server/monitoring/utils");

const sample = {
	BlockIO: "1.5MB / 2.5MB",
	CPUPerc: "5.00%",
	Container: "c1",
	ID: "c1",
	MemPerc: "10.00%",
	MemUsage: "1.2GiB / 2GiB",
	Name: "test-app-1",
	NetIO: "3kB / 4kB",
};

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("recordAdvancedStats ↔ getAdvancedStats round-trip", () => {
	it("parses docker-stats strings and reads them back", async () => {
		await recordAdvancedStats(sample, "rt-app");
		const stats = await getAdvancedStats("rt-app");

		expect(stats.cpu.at(-1)?.value).toBe("5.00%");
		// MemUsage "1.2GiB / 2GiB" splits on spaces → [0]="1.2GiB", [2]="2GiB"
		expect(stats.memory.at(-1)?.value).toEqual({
			used: "1.2GiB",
			total: "2GiB",
		});
		expect(stats.block.at(-1)?.value).toEqual({
			readMb: "1.5MB",
			writeMb: "2.5MB",
		});
		expect(stats.network.at(-1)?.value).toEqual({
			inputMb: "3kB",
			outputMb: "4kB",
		});
	});

	it("does NOT record host-only stats (disk/loadavg/swap) for a non-host app", async () => {
		await recordAdvancedStats(sample, "nonhost-app");
		const stats = await getAdvancedStats("nonhost-app");
		expect(stats.disk).toEqual([]);
		expect(stats.loadavg).toEqual([]);
		expect(stats.swap).toEqual([]);
	});

	it("appends across calls and exposes the latest via getLastAdvancedStatsFile", async () => {
		await recordAdvancedStats({ ...sample, CPUPerc: "1.00%" }, "last-app");
		await recordAdvancedStats({ ...sample, CPUPerc: "2.00%" }, "last-app");
		const all = await getAdvancedStats("last-app");
		expect(all.cpu).toHaveLength(2);
		const last = await getLastAdvancedStatsFile("last-app");
		expect(last.cpu?.value).toBe("2.00%");
	});

	it("caps each stat series at a rolling 288 entries", async () => {
		for (let i = 0; i < 290; i++) {
			await recordAdvancedStats({ ...sample, CPUPerc: `${i}.00%` }, "cap-app");
		}
		const stats = await getAdvancedStats("cap-app");
		expect(stats.cpu).toHaveLength(288);
		// oldest two (0,1) rolled off; newest is 289
		expect(stats.cpu.at(-1)?.value).toBe("289.00%");
		expect(stats.cpu[0]?.value).toBe("2.00%");
	});
});
