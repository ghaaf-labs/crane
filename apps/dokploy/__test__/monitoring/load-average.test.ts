import { buildLoadAverageStat } from "@crane/server/monitoring/utils";
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
