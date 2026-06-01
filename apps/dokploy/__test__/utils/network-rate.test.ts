import { describe, expect, it } from "vitest";
import {
	bytesFromDockerSize,
	bytesFromSizeString,
	formatNetworkRate,
	formatUptime,
	networkRatePerSecond,
} from "@/lib/utils";

describe("formatUptime", () => {
	it("formats days, hours, and minutes", () => {
		expect(formatUptime(5 * 86400 + 3 * 3600 + 12 * 60)).toBe("5d 3h 12m");
	});

	it("omits zero leading units", () => {
		expect(formatUptime(3 * 3600 + 12 * 60)).toBe("3h 12m");
		expect(formatUptime(12 * 60)).toBe("12m");
	});

	it("drops a trailing zero-minute when days/hours are present", () => {
		expect(formatUptime(2 * 86400)).toBe("2d");
		expect(formatUptime(3 * 3600)).toBe("3h");
	});

	it("shows <1m for sub-minute or non-finite uptimes", () => {
		expect(formatUptime(0)).toBe("<1m");
		expect(formatUptime(59)).toBe("<1m");
		expect(formatUptime(Number.NaN)).toBe("<1m");
	});
});

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

describe("bytesFromDockerSize", () => {
	it("treats bare B as bytes", () => {
		expect(bytesFromDockerSize(512, "B")).toBe(512);
	});

	it("scales SI units (docker NetIO/BlockIO are 1000-based)", () => {
		expect(bytesFromDockerSize(1, "kB")).toBe(1000);
		expect(bytesFromDockerSize(2, "MB")).toBe(2_000_000);
		expect(bytesFromDockerSize(1.5, "GB")).toBe(1_500_000_000);
	});

	it("is case-insensitive and tolerates whitespace", () => {
		expect(bytesFromDockerSize(1, "mb")).toBe(1_000_000);
		expect(bytesFromDockerSize(1, " KB ")).toBe(1000);
	});

	it("scales IEC variants as 1024-based", () => {
		expect(bytesFromDockerSize(1, "KiB")).toBe(1024);
		expect(bytesFromDockerSize(1, "MiB")).toBe(1024 * 1024);
	});

	it("scales large SI units (PB/EB) instead of falling back to bytes", () => {
		expect(bytesFromDockerSize(1, "PB")).toBe(1e15);
		expect(bytesFromDockerSize(2, "EB")).toBe(2e18);
		expect(bytesFromDockerSize(1, "PiB")).toBe(1024 ** 5);
	});

	it("keeps a TB→PB cumulative transition monotonic (no fake drop)", () => {
		// 999 TB then 1 PB: as raw numbers 999 > 1 (fake drop); as bytes 1 PB > 999 TB
		expect(bytesFromDockerSize(1, "PB")).toBeGreaterThan(
			bytesFromDockerSize(999, "TB"),
		);
	});

	it("falls back to bytes for unknown or empty units", () => {
		expect(bytesFromDockerSize(42, "")).toBe(42);
		expect(bytesFromDockerSize(42, "???")).toBe(42);
	});

	it("returns 0 for non-finite values", () => {
		expect(bytesFromDockerSize(Number.NaN, "MB")).toBe(0);
	});

	it("composes with networkRatePerSecond for a realistic container series", () => {
		// container transferred 1 MB then 3 MB cumulative over 2s → 1 MB/s
		const prev = bytesFromDockerSize(1, "MB");
		const curr = bytesFromDockerSize(3, "MB");
		const rate = networkRatePerSecond(prev, curr, 0, 2000);
		expect(rate).toBe(1_000_000);
		expect(formatNetworkRate(rate)).toBe("977 KB/s"); // 1e6 / 1024 ≈ 976.6
	});
});

describe("bytesFromSizeString", () => {
	it("parses a combined docker size string with its unit", () => {
		expect(bytesFromSizeString("1.5kB")).toBe(1500);
		expect(bytesFromSizeString("2MB")).toBe(2_000_000);
		expect(bytesFromSizeString("512B")).toBe(512);
		expect(bytesFromSizeString("3.4MiB")).toBe(3.4 * 1024 * 1024);
	});

	it("handles a space between value and unit", () => {
		expect(bytesFromSizeString("1.2 GB")).toBe(1_200_000_000);
	});

	it("passes through finite numbers and seeds 0 from default state", () => {
		expect(bytesFromSizeString(0)).toBe(0);
		expect(bytesFromSizeString(12345)).toBe(12345);
	});

	it("returns 0 for null/undefined/empty/garbage", () => {
		expect(bytesFromSizeString(null)).toBe(0);
		expect(bytesFromSizeString(undefined)).toBe(0);
		expect(bytesFromSizeString("")).toBe(0);
		expect(bytesFromSizeString("N/A")).toBe(0);
	});

	it("treats a unitless numeric string as bytes", () => {
		expect(bytesFromSizeString("4096")).toBe(4096);
		expect(bytesFromSizeString("0")).toBe(0);
	});

	it("rejects signed/exponent/garbage forms instead of mis-scaling them", () => {
		// "1e3B" must NOT become 1000 exabytes; "+1MB" must NOT silently become 1 B
		expect(bytesFromSizeString("1e3B")).toBe(0);
		expect(bytesFromSizeString("+1MB")).toBe(0);
		expect(bytesFromSizeString("-5MB")).toBe(0);
		expect(bytesFromSizeString("1MB/s")).toBe(0);
		expect(bytesFromSizeString("1foo")).toBe(1); // number + unknown unit → bytes
	});

	it("composes with networkRatePerSecond across mixed-unit samples", () => {
		// 900 kB then 1.2 MB cumulative over 3s: raw numbers would be 900 -> 1.2
		// (a fake drop); as bytes it's a real +300 kB / 3s = 100 kB/s.
		const prev = bytesFromSizeString("900kB");
		const curr = bytesFromSizeString("1.2MB");
		const rate = networkRatePerSecond(prev, curr, 0, 3000);
		expect(rate).toBe(100_000);
	});
});
