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
	Network: {
		input: number;
		output: number;
		inputUnit: string;
		outputUnit: string;
	};
}

interface Props {
	data: ContainerMetric[];
}

interface FormattedMetric {
	timestamp: string;
	input: number;
	output: number;
}

const chartConfig = {
	input: {
		label: "Input",
		color: "hsl(var(--chart-3))",
	},
	output: {
		label: "Output",
		color: "hsl(var(--chart-4))",
	},
} satisfies ChartConfig;

export const ContainerNetworkChart = ({ data }: Props) => {
	// docker stats NetIO is a cumulative total since container start, reported
	// with a per-sample unit. Normalise each sample to bytes and derive a
	// per-second throughput from the delta to the previous sample.
	const formattedData: FormattedMetric[] = data.map((metric, index) => {
		const prev = index > 0 ? data[index - 1] : undefined;
		const currInBytes = bytesFromDockerSize(
			metric.Network.input,
			metric.Network.inputUnit,
		);
		const currOutBytes = bytesFromDockerSize(
			metric.Network.output,
			metric.Network.outputUnit,
		);
		const currTimeMs = new Date(metric.timestamp).getTime();

		let input = 0;
		let output = 0;
		if (prev) {
			const prevTimeMs = new Date(prev.timestamp).getTime();
			input = networkRatePerSecond(
				bytesFromDockerSize(prev.Network.input, prev.Network.inputUnit),
				currInBytes,
				prevTimeMs,
				currTimeMs,
			);
			output = networkRatePerSecond(
				bytesFromDockerSize(prev.Network.output, prev.Network.outputUnit),
				currOutBytes,
				prevTimeMs,
				currTimeMs,
			);
		}

		return { timestamp: metric.timestamp, input, output };
	});

	const latestData = formattedData[formattedData.length - 1] || {
		input: 0,
		output: 0,
	};

	return (
		<Card className="bg-transparent">
			<CardHeader className="border-b py-5">
				<CardTitle>Network I/O</CardTitle>
				<CardDescription>
					Input: {formatNetworkRate(latestData.input)} / Output:{" "}
					{formatNetworkRate(latestData.output)}
				</CardDescription>
			</CardHeader>
			<CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
				<ChartContainer
					config={chartConfig}
					className="aspect-auto h-[250px] w-full"
				>
					<AreaChart data={formattedData}>
						<defs>
							<linearGradient id="fillInput" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="hsl(var(--chart-3))"
									stopOpacity={0.8}
								/>
								<stop
									offset="95%"
									stopColor="hsl(var(--chart-3))"
									stopOpacity={0.1}
								/>
							</linearGradient>
							<linearGradient id="fillOutput" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="hsl(var(--chart-4))"
									stopOpacity={0.8}
								/>
								<stop
									offset="95%"
									stopColor="hsl(var(--chart-4))"
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
														Input
													</span>
													<span className="font-bold">
														{formatNetworkRate(data.input ?? 0)}
													</span>
												</div>
												<div className="flex flex-col">
													<span className="text-[0.70rem] uppercase text-muted-foreground">
														Output
													</span>
													<span className="font-bold">
														{formatNetworkRate(data.output ?? 0)}
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
							name="Input"
							dataKey="input"
							type="monotone"
							fill="url(#fillInput)"
							stroke="hsl(var(--chart-3))"
							strokeWidth={2}
						/>
						<Area
							name="Output"
							dataKey="output"
							type="monotone"
							fill="url(#fillOutput)"
							stroke="hsl(var(--chart-4))"
							strokeWidth={2}
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
