import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
} from "@/components/ui/chart";
import {
	bytesFromDockerSize,
	formatNetworkRate,
	formatTimestamp,
	networkRatePerSecond,
} from "@/lib/utils";

interface ContainerMetric {
	timestamp: string;
	BlockIO: {
		read: number;
		write: number;
		readUnit: string;
		writeUnit: string;
	};
}

interface Props {
	data: ContainerMetric[];
}

const chartConfig = {
	read: {
		label: "Read",
		color: "hsl(217, 91%, 60%)", // Azul brillante
	},
	write: {
		label: "Write",
		color: "hsl(142, 71%, 45%)", // Verde brillante
	},
} satisfies ChartConfig;

export const ContainerBlockChart = ({ data }: Props) => {
	// docker stats BlockIO is a cumulative total since container start, reported
	// with a per-sample unit. Normalise to bytes and derive a per-second disk
	// throughput from the delta to the previous sample.
	const formattedData = data.map((metric, index) => {
		const prev = index > 0 ? data[index - 1] : undefined;
		const currReadBytes = bytesFromDockerSize(
			metric.BlockIO.read,
			metric.BlockIO.readUnit,
		);
		const currWriteBytes = bytesFromDockerSize(
			metric.BlockIO.write,
			metric.BlockIO.writeUnit,
		);
		const currTimeMs = new Date(metric.timestamp).getTime();

		let read = 0;
		let write = 0;
		if (prev) {
			const prevTimeMs = new Date(prev.timestamp).getTime();
			read = networkRatePerSecond(
				bytesFromDockerSize(prev.BlockIO.read, prev.BlockIO.readUnit),
				currReadBytes,
				prevTimeMs,
				currTimeMs,
			);
			write = networkRatePerSecond(
				bytesFromDockerSize(prev.BlockIO.write, prev.BlockIO.writeUnit),
				currWriteBytes,
				prevTimeMs,
				currTimeMs,
			);
		}

		return { timestamp: metric.timestamp, read, write };
	});

	const latestData = formattedData[formattedData.length - 1] || {
		timestamp: "",
		read: 0,
		write: 0,
	};

	return (
		<Card className="bg-transparent">
			<CardHeader className="border-b py-5">
				<CardTitle>Block I/O</CardTitle>
				<CardDescription>
					Read: {formatNetworkRate(latestData.read)} / Write:{" "}
					{formatNetworkRate(latestData.write)}
				</CardDescription>
			</CardHeader>
			<CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
				<ChartContainer
					config={chartConfig}
					className="aspect-auto h-[250px] w-full"
				>
					<AreaChart data={formattedData}>
						<defs>
							<linearGradient id="fillRead" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="hsl(217, 91%, 60%)"
									stopOpacity={0.3}
								/>
								<stop
									offset="95%"
									stopColor="hsl(217, 91%, 60%)"
									stopOpacity={0.1}
								/>
							</linearGradient>
							<linearGradient id="fillWrite" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="hsl(142, 71%, 45%)"
									stopOpacity={0.3}
								/>
								<stop
									offset="95%"
									stopColor="hsl(142, 71%, 45%)"
									stopOpacity={0.1}
								/>
							</linearGradient>
						</defs>
						<CartesianGrid vertical={false} />
						<XAxis
							dataKey="timestamp"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={32}
							tickFormatter={(value) => formatTimestamp(value)}
						/>
						<YAxis tickFormatter={(value) => formatNetworkRate(value)} />
						<ChartTooltip
							cursor={false}
							content={({ active, payload, label }) => {
								if (active && payload && payload.length) {
									const data = payload?.[0]?.payload;
									return (
										<div className="rounded-lg border bg-background p-2 shadow-sm">
											<div className="grid grid-cols-2 gap-2">
												<div className="flex flex-col">
													<span className="text-[0.70rem] uppercase text-muted-foreground">
														Time
													</span>
													<span className="font-bold">
														{formatTimestamp(label)}
													</span>
												</div>
												<div className="flex flex-col">
													<span className="text-[0.70rem] uppercase text-muted-foreground">
														Read
													</span>
													<span className="font-bold">
														{formatNetworkRate(data.read ?? 0)}
													</span>
												</div>
												<div className="flex flex-col">
													<span className="text-[0.70rem] uppercase text-muted-foreground">
														Write
													</span>
													<span className="font-bold">
														{formatNetworkRate(data.write ?? 0)}
													</span>
												</div>
											</div>
										</div>
									);
								}
								return null;
							}}
						/>
						<Area
							name="Write"
							dataKey="write"
							type="monotone"
							fill="url(#fillWrite)"
							stroke="hsl(142, 71%, 45%)"
							strokeWidth={2}
							fillOpacity={0.3}
						/>
						<Area
							name="Read"
							dataKey="read"
							type="monotone"
							fill="url(#fillRead)"
							stroke="hsl(217, 91%, 60%)"
							strokeWidth={2}
							fillOpacity={0.3}
						/>
						<ChartLegend
							content={<ChartLegendContent />}
							verticalAlign="bottom"
							align="center"
						/>
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
};
