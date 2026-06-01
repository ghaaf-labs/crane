import {
	buildLoadAverageStat,
	getHostSystemInfo,
	parseSwapFromMeminfo,
} from "@crane/server/monitoring/utils";
import { describe, expect, it } from "vitest";

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
	});
});
