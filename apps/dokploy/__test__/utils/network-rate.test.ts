import { describe, expect, it } from "vitest";
import { formatNetworkRate, networkRatePerSecond } from "@/lib/utils";

describe("networkRatePerSecond", () => {
	it("computes throughput from a cumulative counter delta", () => {
		// 2 MB transferred over 2 seconds = 1 MB/s
		const rate = networkRatePerSecond(0, 2 * 1024 * 1024, 1000, 3000);
		expect(rate).toBe(1024 * 1024);
	});

	it("returns 0 when the counter resets (reboot / service restart)", () => {
		// current < previous → negative delta must not produce a negative spike
		expect(networkRatePerSecond(5_000_000, 1_000, 1000, 6000)).toBe(0);
	});

	it("returns 0 for a zero or negative time gap", () => {
		expect(networkRatePerSecond(0, 1_000_000, 5000, 5000)).toBe(0);
		expect(networkRatePerSecond(0, 1_000_000, 5000, 4000)).toBe(0);
	});

	it("returns 0 for non-finite inputs", () => {
		expect(networkRatePerSecond(Number.NaN, 1000, 0, 1000)).toBe(0);
		expect(networkRatePerSecond(0, Number.POSITIVE_INFINITY, 0, 1000)).toBe(0);
	});

	it("scales with the time delta", () => {
		// 1 MB over 1s = 1 MB/s; same bytes over 4s = 256 KB/s
		expect(networkRatePerSecond(0, 1024 * 1024, 0, 1000)).toBe(1024 * 1024);
		expect(networkRatePerSecond(0, 1024 * 1024, 0, 4000)).toBe(256 * 1024);
	});
});

describe("formatNetworkRate", () => {
	it("renders 0 and non-positive values as 0 B/s", () => {
		expect(formatNetworkRate(0)).toBe("0 B/s");
		expect(formatNetworkRate(-5)).toBe("0 B/s");
		expect(formatNetworkRate(Number.NaN)).toBe("0 B/s");
	});

	it("uses B/s below 1 KiB (no decimals)", () => {
		expect(formatNetworkRate(512)).toBe("512 B/s");
	});

	it("scales to KB/s, MB/s, and GB/s", () => {
		expect(formatNetworkRate(2 * 1024)).toBe("2.0 KB/s");
		expect(formatNetworkRate(3.5 * 1024 * 1024)).toBe("3.5 MB/s");
		expect(formatNetworkRate(2 * 1024 * 1024 * 1024)).toBe("2.0 GB/s");
	});

	it("drops decimals once the scaled value is >= 100", () => {
		expect(formatNetworkRate(150 * 1024)).toBe("150 KB/s");
	});
});
