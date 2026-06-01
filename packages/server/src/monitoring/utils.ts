import { promises } from "node:fs";
import os from "node:os";
import { OSUtils } from "node-os-utils";
import { paths } from "../constants";

export interface Container {
	BlockIO: string;
	CPUPerc: string;
	Container: string;
	ID: string;
	MemPerc: string;
	MemUsage: string;
	Name: string;
	NetIO: string;
}

export interface LoadAverageStat {
	load1: number;
	load5: number;
	load15: number;
	cores: number;
}

/**
 * Shapes the OS load average (1/5/15-minute) plus the logical core count into a
 * rounded, JSON-friendly stat. Pure so it can be unit-tested without the OS.
 * Load is meaningful relative to `cores` (load ≈ cores means fully busy).
 * Inside a container os.loadavg() still reflects the host (Linux /proc/loadavg).
 */
export const buildLoadAverageStat = (
	loadavg: number[],
	cores: number,
): LoadAverageStat => {
	const round = (n: number | undefined): number =>
		typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
	return {
		load1: round(loadavg[0]),
		load5: round(loadavg[1]),
		load15: round(loadavg[2]),
		cores: cores > 0 ? cores : 0,
	};
};

export interface SwapStat {
	swapTotal: number; // MB
	swapUsed: number; // MB
	swapFree: number; // MB
	swapUsedPercentage: number; // 0-100
}

/**
 * Pure: parse SwapTotal/SwapFree (kB) out of /proc/meminfo text into MB + a used
 * percentage. Returns null if the fields are absent/unparsable (e.g. non-Linux
 * or swap disabled at the kernel level). Inside a container /proc/meminfo still
 * reflects the host. Tested without touching the filesystem.
 */
export const parseSwapFromMeminfo = (meminfo: string): SwapStat | null => {
	const totalMatch = meminfo.match(/^SwapTotal:\s+(\d+)\s*kB/m);
	const freeMatch = meminfo.match(/^SwapFree:\s+(\d+)\s*kB/m);
	if (!totalMatch?.[1] || !freeMatch?.[1]) return null;
	const totalKb = Number(totalMatch[1]);
	const freeKb = Number(freeMatch[1]);
	if (!Number.isFinite(totalKb) || !Number.isFinite(freeKb)) return null;
	// Clamp free to total so the fields stay self-consistent on any anomaly.
	const normalizedFreeKb = Math.min(Math.max(0, freeKb), totalKb);
	const usedKb = totalKb - normalizedFreeKb;
	const toMb = (kb: number) => Math.round((kb / 1024) * 100) / 100;
	return {
		swapTotal: toMb(totalKb),
		swapUsed: toMb(usedKb),
		swapFree: toMb(normalizedFreeKb),
		swapUsedPercentage:
			totalKb > 0 ? Math.round((usedKb / totalKb) * 10000) / 100 : 0,
	};
};

const readSwapStat = async (): Promise<SwapStat | null> => {
	try {
		const meminfo = await promises.readFile("/proc/meminfo", "utf-8");
		return parseSwapFromMeminfo(meminfo);
	} catch {
		return null;
	}
};
export const recordAdvancedStats = async (
	stats: Container,
	appName: string,
) => {
	const { MONITORING_PATH } = paths();
	const path = `${MONITORING_PATH}/${appName}`;

	await promises.mkdir(path, { recursive: true });

	await updateStatsFile(appName, "cpu", stats.CPUPerc);
	await updateStatsFile(appName, "memory", {
		used: stats.MemUsage.split(" ")[0],
		total: stats.MemUsage.split(" ")[2],
	});

	await updateStatsFile(appName, "block", {
		readMb: stats.BlockIO.split(" ")[0],
		writeMb: stats.BlockIO.split(" ")[2],
	});

	await updateStatsFile(appName, "network", {
		inputMb: stats.NetIO.split(" ")[0],
		outputMb: stats.NetIO.split(" ")[2],
	});

	if (appName === "dokploy") {
		const osutils = new OSUtils();
		const diskResult = await osutils.disk.usageByMountPoint("/");

		if (diskResult.success && diskResult.data) {
			const disk = diskResult.data;
			const diskUsage = disk.used.toGB().toFixed(2);
			const diskTotal = disk.total.toGB().toFixed(2);
			const diskUsedPercentage = disk.usagePercentage;
			const diskFree = disk.available.toGB().toFixed(2);

			await updateStatsFile(appName, "disk", {
				diskTotal: +diskTotal,
				diskUsedPercentage: +diskUsedPercentage,
				diskUsage: +diskUsage,
				diskFree: +diskFree,
			});
		}

		await updateStatsFile(
			appName,
			"loadavg",
			buildLoadAverageStat(os.loadavg(), os.cpus().length),
		);

		const swap = await readSwapStat();
		if (swap) {
			await updateStatsFile(appName, "swap", swap);
		}
	}
};

/**
 * Get host system statistics using node-os-utils
 * This is used when monitoring "dokploy" to show host stats instead of container stats
 */
export const getHostSystemStats = async (): Promise<Container> => {
	const osutils = new OSUtils({
		disk: {
			includeStats: true, // Enable disk I/O statistics
		},
	});

	// Get CPU usage
	const cpuResult = await osutils.cpu.usage();
	const cpuUsage = cpuResult.success ? cpuResult.data : 0;

	// Get memory info
	const memResult = await osutils.memory.info();
	let memUsedGB = 0;
	let memTotalGB = 0;
	let memUsedPercent = 0;
	if (memResult.success) {
		memTotalGB = memResult.data.total.toGB();
		memUsedGB = memResult.data.used.toGB();
		memUsedPercent = memResult.data.usagePercentage;
	}

	// Get network stats from network.overview()
	let netInputBytes = 0;
	let netOutputBytes = 0;
	const networkOverview = await osutils.network.overview();
	if (networkOverview.success) {
		netInputBytes = networkOverview.data.totalRxBytes.toBytes();
		netOutputBytes = networkOverview.data.totalTxBytes.toBytes();
	}

	// Get Block I/O from disk.stats()
	let blockReadBytes = 0;
	let blockWriteBytes = 0;
	const diskStats = await osutils.disk.stats();
	if (diskStats.success && diskStats.data.length > 0) {
		// Filter out virtual devices (loop, ram, sr, etc.) - only include real disk devices
		const excludePatterns = [/^loop/, /^ram/, /^sr\d+$/, /^fd\d+$/];
		for (const stat of diskStats.data) {
			// Skip virtual devices
			if (
				stat.device &&
				excludePatterns.some((pattern) => pattern.test(stat.device))
			) {
				continue;
			}
			// readBytes and writeBytes are DataSize objects with .toBytes() method
			blockReadBytes += stat.readBytes.toBytes();
			blockWriteBytes += stat.writeBytes.toBytes();
		}
	}

	// Format values similar to docker stats
	const formatBytes = (bytes: number): string => {
		if (bytes >= 1024 * 1024 * 1024) {
			return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GiB`;
		}
		if (bytes >= 1024 * 1024) {
			return `${(bytes / (1024 * 1024)).toFixed(2)}MiB`;
		}
		if (bytes >= 1024) {
			return `${(bytes / 1024).toFixed(2)}KiB`;
		}
		return `${bytes}B`;
	};

	// Format memory usage similar to docker stats format: "used / total"
	const memUsedFormatted = `${memUsedGB.toFixed(2)}GiB`;
	const memTotalFormatted = `${memTotalGB.toFixed(2)}GiB`;
	const memUsageFormatted = `${memUsedFormatted} / ${memTotalFormatted}`;

	// Format network I/O
	const netInputMb = netInputBytes / (1024 * 1024);
	const netOutputMb = netOutputBytes / (1024 * 1024);
	const netIOFormatted = `${netInputMb.toFixed(2)}MB / ${netOutputMb.toFixed(2)}MB`;

	// Format Block I/O
	const blockIOFormatted = `${formatBytes(blockReadBytes)} / ${formatBytes(blockWriteBytes)}`;

	// Create a stat object compatible with recordAdvancedStats
	return {
		CPUPerc: `${cpuUsage.toFixed(2)}%`,
		MemPerc: `${memUsedPercent.toFixed(2)}%`,
		MemUsage: memUsageFormatted,
		BlockIO: blockIOFormatted,
		NetIO: netIOFormatted,
		Container: "dokploy",
		ID: "host-system",
		Name: "dokploy",
	};
};

export const getAdvancedStats = async (appName: string) => {
	return {
		cpu: await readStatsFile(appName, "cpu"),
		memory: await readStatsFile(appName, "memory"),
		disk: await readStatsFile(appName, "disk"),
		network: await readStatsFile(appName, "network"),
		block: await readStatsFile(appName, "block"),
		loadavg: await readStatsFile(appName, "loadavg"),
		swap: await readStatsFile(appName, "swap"),
	};
};

export const readStatsFile = async (
	appName: string,
	statType:
		| "cpu"
		| "memory"
		| "disk"
		| "network"
		| "block"
		| "loadavg"
		| "swap",
) => {
	try {
		const { MONITORING_PATH } = paths();
		const filePath = `${MONITORING_PATH}/${appName}/${statType}.json`;
		const data = await promises.readFile(filePath, "utf-8");
		return JSON.parse(data);
	} catch {
		return [];
	}
};

export const updateStatsFile = async (
	appName: string,
	statType:
		| "cpu"
		| "memory"
		| "disk"
		| "network"
		| "block"
		| "loadavg"
		| "swap",
	value: number | string | unknown,
) => {
	const { MONITORING_PATH } = paths();
	const stats = await readStatsFile(appName, statType);
	stats.push({ value, time: new Date() });

	if (stats.length > 288) {
		stats.shift();
	}

	const content = JSON.stringify(stats);
	await promises.writeFile(
		`${MONITORING_PATH}/${appName}/${statType}.json`,
		content,
	);
};

export const readLastValueStatsFile = async (
	appName: string,
	statType:
		| "cpu"
		| "memory"
		| "disk"
		| "network"
		| "block"
		| "loadavg"
		| "swap",
) => {
	try {
		const { MONITORING_PATH } = paths();
		const filePath = `${MONITORING_PATH}/${appName}/${statType}.json`;
		const data = await promises.readFile(filePath, "utf-8");
		const stats = JSON.parse(data);
		return stats[stats.length - 1] || null;
	} catch {
		return null;
	}
};

export const getLastAdvancedStatsFile = async (appName: string) => {
	return {
		cpu: await readLastValueStatsFile(appName, "cpu"),
		memory: await readLastValueStatsFile(appName, "memory"),
		disk: await readLastValueStatsFile(appName, "disk"),
		network: await readLastValueStatsFile(appName, "network"),
		block: await readLastValueStatsFile(appName, "block"),
		loadavg: await readLastValueStatsFile(appName, "loadavg"),
		swap: await readLastValueStatsFile(appName, "swap"),
	};
};
