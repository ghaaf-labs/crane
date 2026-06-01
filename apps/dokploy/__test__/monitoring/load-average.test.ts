import {
	buildLoadAverageStat,
	computePerCoreUsage,
	getHostSystemInfo,
	parseSwapFromMeminfo,
} from "@crane/server/monitoring/utils";
import { describe, expect, it } from "vitest";

const t = (user: number, idle: number) => ({
	user,
	nice: 0,
	sys: 0,
	idle,
	irq: 0,
});

describe("buildLoadAverageStat", () => {
	it("shapes os.loadavg() + core count, rounding to 2 decimals", () => {
		expect(buildLoadAverageStat([0.123, 0.456, 1.789], 8)).toEqual({
			load1: 0.12,
			load5: 0.46,
			load15: 1.79,
			cores: 8,
		});
	});

	it("defaults missing load entries to 0", () => {
		expect(buildLoadAverageStat([], 4)).toEqual({
			load1: 0,
			load5: 0,
			load15: 0,
			cores: 4,
		});
		expect(buildLoadAverageStat([1.5], 4)).toEqual({
			load1: 1.5,
			load5: 0,
			load15: 0,
			cores: 4,
		});
	});

	it("guards non-finite load values", () => {
		expect(
			buildLoadAverageStat([Number.NaN, Number.POSITIVE_INFINITY, 2], 2),
		).toEqual({ load1: 0, load5: 0, load15: 2, cores: 2 });
	});

	it("clamps a non-positive core count to 0", () => {
		expect(buildLoadAverageStat([1, 1, 1], 0).cores).toBe(0);
		expect(buildLoadAverageStat([1, 1, 1], -4).cores).toBe(0);
	});
});

describe("parseSwapFromMeminfo", () => {
	const meminfo = (total: string, free: string) =>
		`MemTotal:       16384000 kB\nSwapTotal:      ${total} kB\nSwapFree:       ${free} kB\nDirty:                 0 kB\n`;

	it("parses SwapTotal/SwapFree into MB + used percentage", () => {
		// 2,097,152 kB total = 2048 MB; 1,048,576 kB free = 1024 MB used = 50%
		const swap = parseSwapFromMeminfo(meminfo("2097152", "1048576"));
		expect(swap).toEqual({
			swapTotal: 2048,
			swapUsed: 1024,
			swapFree: 1024,
			swapUsedPercentage: 50,
		});
	});

	it("reports 0% when swap is disabled (total 0)", () => {
		const swap = parseSwapFromMeminfo(meminfo("0", "0"));
		expect(swap).toEqual({
			swapTotal: 0,
			swapUsed: 0,
			swapFree: 0,
			swapUsedPercentage: 0,
		});
	});

	it("returns null when the swap fields are absent (non-Linux)", () => {
		expect(parseSwapFromMeminfo("MemTotal: 16384000 kB\n")).toBeNull();
		expect(parseSwapFromMeminfo("")).toBeNull();
	});

	it("clamps a free>total anomaly so fields stay self-consistent", () => {
		const swap = parseSwapFromMeminfo(meminfo("1024", "2048"));
		expect(swap?.swapUsed).toBe(0);
		expect(swap?.swapUsedPercentage).toBe(0);
		// free is clamped to total (1024 kB → 1 MB), not left as the raw 2 MB
		expect(swap?.swapFree).toBe(1);
		expect(swap?.swapTotal).toBe(1);
	});
});

describe("computePerCoreUsage", () => {
	it("computes per-core busy% from cumulative tick deltas", () => {
		// core0: +50 user, +50 idle over interval → 50% busy
		// core1: +90 user, +10 idle → 90% busy
		const prev = [t(0, 0), t(0, 0)];
		const curr = [t(50, 50), t(90, 10)];
		expect(computePerCoreUsage(prev, curr)).toEqual([50, 90]);
	});

	it("returns 0 for a fully idle core and 100 for a fully busy core", () => {
		const prev = [t(0, 0), t(0, 0)];
		const curr = [t(0, 100), t(100, 0)];
		expect(computePerCoreUsage(prev, curr)).toEqual([0, 100]);
	});

	it("yields zeros on a length mismatch or no interval", () => {
		expect(computePerCoreUsage([t(0, 0)], [t(1, 1), t(2, 2)])).toEqual([0, 0]);
		// no tick movement → totalDelta 0 → 0
		expect(computePerCoreUsage([t(5, 5)], [t(5, 5)])).toEqual([0]);
	});

	it("clamps a counter reset (negative delta) to 0", () => {
		expect(computePerCoreUsage([t(100, 100)], [t(0, 0)])).toEqual([0]);
	});

	it("clamps to 100 when idle goes backwards but total advances", () => {
		// idleΔ = 40-50 = -10, totalΔ = (160+40)-(50+50) = 100 → (1-(-10/100))*100 = 110 → 100
		expect(computePerCoreUsage([t(50, 50)], [t(160, 40)])).toEqual([100]);
	});
});

describe("getHostSystemInfo", () => {
	it("returns a well-formed host info object from the OS", () => {
		const info = getHostSystemInfo();
		expect(typeof info.cpuModel).toBe("string");
		expect(info.cpuModel.length).toBeGreaterThan(0);
		expect(info.cpuCores).toBeGreaterThan(0);
		expect(Number.isInteger(info.cpuCores)).toBe(true);
		expect(typeof info.arch).toBe("string");
		expect(typeof info.platform).toBe("string");
		expect(typeof info.release).toBe("string");
		expect(info.totalMemGb).toBeGreaterThan(0);
		expect(Number.isInteger(info.uptimeSeconds)).toBe(true);
		expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
	});
});
