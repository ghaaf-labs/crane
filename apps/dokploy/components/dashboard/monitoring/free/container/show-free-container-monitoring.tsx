import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/utils/api";
import { DockerBlockChart } from "./docker-block-chart";
import { DockerCpuChart } from "./docker-cpu-chart";
import { DockerDiskChart } from "./docker-disk-chart";
import { DockerDiskUsageChart } from "./docker-disk-usage-chart";
import { DockerLoadChart } from "./docker-load-chart";
import { DockerMemoryChart } from "./docker-memory-chart";
import { DockerNetworkChart } from "./docker-network-chart";
import { DockerSwapChart } from "./docker-swap-chart";

const defaultData = {
	cpu: {
		value: "0%",
		time: "",
	},
	memory: {
		value: {
			used: 0,
			total: 0,
		},
		time: "",
	},
	block: {
		value: {
			readMb: 0,
			writeMb: 0,
		},
		time: "",
	},
	network: {
		value: {
			inputMb: 0,
			outputMb: 0,
		},
		time: "",
	},
	disk: {
		value: { diskTotal: 0, diskUsage: 0, diskUsedPercentage: 0, diskFree: 0 },
		time: "",
	},
	loadavg: {
		value: { load1: 0, load5: 0, load15: 0, cores: 0 },
		time: "",
	},
	swap: {
		value: { swapTotal: 0, swapUsed: 0, swapFree: 0, swapUsedPercentage: 0 },
		time: "",
	},
	percore: {
		value: [] as number[],
		time: "",
	},
};

interface Props {
	appName: string;
	appType?: "application" | "stack" | "docker-compose";
}
export interface DockerStats {
	cpu: {
		value: string;
		time: string;
	};
	memory: {
		value: {
			used: number;
			total: number;
		};
		time: string;
	};
	block: {
		// stored as cumulative docker BlockIO strings (e.g. "1.2MB"); the default
		// state seeds them as 0, hence number | string.
		value: {
			readMb: number | string;
			writeMb: number | string;
		};
		time: string;
	};
	network: {
		// stored as cumulative docker NetIO strings (e.g. "1.2kB"); see above.
		value: {
			inputMb: number | string;
			outputMb: number | string;
		};
		time: string;
	};
	disk: {
		value: {
			diskTotal: number;
			diskUsage: number;
			diskUsedPercentage: number;
			diskFree: number;
		};

		time: string;
	};
	// Host-only (recorded for appName "dokploy"): OS load average + core count.
	loadavg: {
		value: {
			load1: number;
			load5: number;
			load15: number;
			cores: number;
		};
		time: string;
	};
	// Host-only: swap usage (MB) from /proc/meminfo.
	swap: {
		value: {
			swapTotal: number;
			swapUsed: number;
			swapFree: number;
			swapUsedPercentage: number;
		};
		time: string;
	};
	// Host-only: per-core CPU busy-% (one entry per logical core).
	percore: {
		value: number[];
		time: string;
	};
}

export type DockerStatsJSON = {
	cpu: DockerStats["cpu"][];
	memory: DockerStats["memory"][];
	block: DockerStats["block"][];
	network: DockerStats["network"][];
	disk: DockerStats["disk"][];
	loadavg: DockerStats["loadavg"][];
	swap: DockerStats["swap"][];
	percore: DockerStats["percore"][];
};

export const convertMemoryToBytes = (
	memoryString: string | undefined,
): number => {
	if (!memoryString || typeof memoryString !== "string") {
		return 0;
	}

	const value = Number.parseFloat(memoryString) || 0;
	const unit = memoryString.replace(/[0-9.]/g, "").trim();

	switch (unit) {
		case "KiB":
			return value * 1024;
		case "MiB":
			return value * 1024 * 1024;
		case "GiB":
			return value * 1024 * 1024 * 1024;
		case "TiB":
			return value * 1024 * 1024 * 1024 * 1024;
		default:
			return value;
	}
};

export const ContainerFreeMonitoring = ({
	appName,
	appType = "application",
}: Props) => {
	const { data } = api.application.readAppMonitoring.useQuery(
		{ appName },
		{
			refetchOnWindowFocus: false,
		},
	);
	// Host-only static hardware/OS info (the paid dashboard shows this; the free
	// host view did not).
	const { data: systemInfo } = api.user.getHostSystemInfo.useQuery(undefined, {
		enabled: appName === "dokploy",
		refetchOnWindowFocus: false,
	});
	const [accumulativeData, setAccumulativeData] = useState<DockerStatsJSON>({
		cpu: [],
		memory: [],
		block: [],
		network: [],
		disk: [],
		loadavg: [],
		swap: [],
		percore: [],
	});
	const [currentData, setCurrentData] = useState<DockerStats>(defaultData);

	useEffect(() => {
		setCurrentData(defaultData);

		setAccumulativeData({
			cpu: [],
			memory: [],
			block: [],
			network: [],
			disk: [],
			loadavg: [],
			swap: [],
			percore: [],
		});
	}, [appName]);

	useEffect(() => {
		if (!data) return;

		setCurrentData({
			cpu: data.cpu[data.cpu.length - 1] ?? currentData.cpu,
			memory: data.memory[data.memory.length - 1] ?? currentData.memory,
			block: data.block[data.block.length - 1] ?? currentData.block,
			network: data.network[data.network.length - 1] ?? currentData.network,
			disk: data.disk[data.disk.length - 1] ?? currentData.disk,
			loadavg: data.loadavg?.[data.loadavg.length - 1] ?? currentData.loadavg,
			swap: data.swap?.[data.swap.length - 1] ?? currentData.swap,
			percore: data.percore?.[data.percore.length - 1] ?? currentData.percore,
		});
		setAccumulativeData({
			block: data?.block || [],
			cpu: data?.cpu || [],
			disk: data?.disk || [],
			memory: data?.memory || [],
			network: data?.network || [],
			loadavg: data?.loadavg || [],
			swap: data?.swap || [],
			percore: data?.percore || [],
		});
	}, [data]);

	useEffect(() => {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/listen-docker-stats-monitoring?appName=${appName}&appType=${appType}`;
		const ws = new WebSocket(wsUrl);

		ws.onmessage = (e) => {
			const value = JSON.parse(e.data);
			if (!value) return;

			const data = {
				cpu: value.data.cpu ?? currentData.cpu,
				memory: value.data.memory ?? currentData.memory,
				block: value.data.block ?? currentData.block,
				disk: value.data.disk ?? currentData.disk,
				network: value.data.network ?? currentData.network,
				loadavg: value.data.loadavg ?? currentData.loadavg,
				swap: value.data.swap ?? currentData.swap,
				percore: value.data.percore ?? currentData.percore,
			};

			setCurrentData(data);

			const MAX_DATA_POINTS = 300;
			setAccumulativeData((prevData) => ({
				cpu: [...prevData.cpu, data.cpu].slice(-MAX_DATA_POINTS),
				memory: [...prevData.memory, data.memory].slice(-MAX_DATA_POINTS),
				block: [...prevData.block, data.block].slice(-MAX_DATA_POINTS),
				network: [...prevData.network, data.network].slice(-MAX_DATA_POINTS),
				disk: [...prevData.disk, data.disk].slice(-MAX_DATA_POINTS),
				loadavg: [...prevData.loadavg, data.loadavg].slice(-MAX_DATA_POINTS),
				swap: [...prevData.swap, data.swap].slice(-MAX_DATA_POINTS),
				percore: [...prevData.percore, data.percore].slice(-MAX_DATA_POINTS),
			}));
		};

		ws.onclose = (e) => {
			console.log(e.reason);
		};

		return () => ws.close();
	}, [appName]);

	return (
		<div className="rounded-xl bg-background flex flex-col gap-4">
			<header className="flex items-center justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
					<p className="text-sm text-muted-foreground">
						Watch the usage of your server in the current app
					</p>
				</div>
			</header>

			{appName === "dokploy" && systemInfo && (
				<Card className="bg-background">
					<CardContent className="flex flex-wrap gap-x-8 gap-y-2 p-4 text-sm">
						<div className="flex flex-col">
							<span className="text-xs text-muted-foreground">CPU</span>
							<span className="font-medium">
								{systemInfo.cpuModel} · {systemInfo.cpuCores} cores
							</span>
						</div>
						<div className="flex flex-col">
							<span className="text-xs text-muted-foreground">Memory</span>
							<span className="font-medium">{systemInfo.totalMemGb} GB</span>
						</div>
						<div className="flex flex-col">
							<span className="text-xs text-muted-foreground">Platform</span>
							<span className="font-medium">
								{systemInfo.platform} {systemInfo.release} ({systemInfo.arch})
							</span>
						</div>
					</CardContent>
				</Card>
			)}

			<div className="grid gap-6 lg:grid-cols-2">
				<Card className="bg-background">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-2 w-full">
							<span className="text-sm text-muted-foreground">
								Used: {String(currentData.cpu.value ?? "0%")}
							</span>
							<Progress
								value={Number.parseInt(
									String(currentData.cpu.value ?? "0%").replace("%", ""),
									10,
								)}
								className="w-[100%]"
							/>
							<DockerCpuChart accumulativeData={accumulativeData.cpu} />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-background">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-2 w-full">
							<span className="text-sm text-muted-foreground">
								{`Used:  ${currentData.memory.value.used} / Limit: ${currentData.memory.value.total} `}
							</span>
							<Progress
								value={
									// @ts-ignore
									(convertMemoryToBytes(currentData.memory.value.used) /
										// @ts-ignore
										convertMemoryToBytes(currentData.memory.value.total)) *
									100
								}
								className="w-[100%]"
							/>
							<DockerMemoryChart
								accumulativeData={accumulativeData.memory}
								memoryLimitGB={
									// @ts-ignore
									convertMemoryToBytes(currentData.memory.value.total) /
									1024 ** 3
								}
							/>
						</div>
					</CardContent>
				</Card>
				{appName === "dokploy" && (
					<Card className="bg-background">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Disk Space</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-col gap-2 w-full">
								<span className="text-sm text-muted-foreground">
									{`Used:  ${currentData.disk.value.diskUsage} GB / Limit: ${currentData.disk.value.diskTotal} GB`}
								</span>
								<Progress
									value={currentData.disk.value.diskUsedPercentage}
									className="w-[100%]"
								/>
								<DockerDiskChart
									accumulativeData={accumulativeData.disk}
									diskTotal={currentData.disk.value.diskTotal}
								/>
							</div>
						</CardContent>
					</Card>
				)}
				{appName === "dokploy" && (
					<Card className="bg-background">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">
								Load Average
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-col gap-2 w-full">
								<span className="text-sm text-muted-foreground">
									{`1m: ${currentData.loadavg.value.load1}  / 5m: ${currentData.loadavg.value.load5}  / 15m: ${currentData.loadavg.value.load15}`}
									{currentData.loadavg.value.cores > 0
										? `  (${currentData.loadavg.value.cores} cores)`
										: ""}
								</span>
								<DockerLoadChart accumulativeData={accumulativeData.loadavg} />
							</div>
						</CardContent>
					</Card>
				)}
				{appName === "dokploy" && currentData.swap.value.swapTotal > 0 && (
					<Card className="bg-background">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Swap</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-col gap-2 w-full">
								<span className="text-sm text-muted-foreground">
									{`Used: ${currentData.swap.value.swapUsed} MB / ${currentData.swap.value.swapTotal} MB (${currentData.swap.value.swapUsedPercentage}%)`}
								</span>
								<DockerSwapChart accumulativeData={accumulativeData.swap} />
							</div>
						</CardContent>
					</Card>
				)}
				{appName === "dokploy" && currentData.percore.value.length > 0 && (
					<Card className="bg-background">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">
								Per-Core CPU
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-2 gap-x-4 gap-y-2">
								{currentData.percore.value.map((pct, index) => (
									<div
										key={`core-${index}`}
										className="flex items-center gap-2"
									>
										<span className="text-xs text-muted-foreground w-12 shrink-0">
											Core {index}
										</span>
										<Progress value={pct} className="flex-1" />
										<span className="text-xs w-10 text-right tabular-nums shrink-0">
											{pct}%
										</span>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}
				{appName === "dokploy" && (
					<Card className="bg-background">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">
								Docker Disk Usage
							</CardTitle>
						</CardHeader>
						<CardContent>
							<DockerDiskUsageChart />
						</CardContent>
					</Card>
				)}

				<Card className="bg-background">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Block I/O</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-2 w-full">
							<span className="text-sm text-muted-foreground">
								{`Read:  ${currentData.block.value.readMb}  / Write: ${currentData.block.value.writeMb} `}
							</span>
							<DockerBlockChart accumulativeData={accumulativeData.block} />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-background">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Network I/O</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-2 w-full">
							<span className="text-sm text-muted-foreground">
								{`In: ${currentData.network.value.inputMb}  / Out: ${currentData.network.value.outputMb} `}
							</span>
							<DockerNetworkChart accumulativeData={accumulativeData.network} />
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
};
