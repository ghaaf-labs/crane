import { format } from "date-fns";
import { Area, AreaChart, CartesianGrid, YAxis } from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	bytesFromSizeString,
	formatNetworkRate,
	networkRatePerSecond,
} from "@/lib/utils";
import type { DockerStatsJSON } from "./show-free-container-monitoring";

interface Props {
	accumulativeData: DockerStatsJSON["network"];
}

const chartConfig = {
	inRate: {
		label: "In",
		color: "hsl(var(--chart-1))",
	},
	outRate: {
		label: "Out",
		color: "hsl(var(--chart-2))",
	},
} satisfies ChartConfig;

export const DockerNetworkChart = ({ accumulativeData }: Props) => {
	// inputMb/outputMb are stored as cumulative docker NetIO strings (e.g.
	// "1.2kB"). Normalise to bytes and derive a per-second throughput from the
	// delta to the previous sample so the chart shows traffic, not a total.
	const transformedData = accumulativeData.map((item, index) => {
		const prev = index > 0 ? accumulativeData[index - 1] : undefined;
		const currIn = bytesFromSizeString(item.value.inputMb);
		const currOut = bytesFromSizeString(item.value.outputMb);
		const currTimeMs = new Date(item.time).getTime();

		let inRate = 0;
		let outRate = 0;
		if (prev) {
			const prevTimeMs = new Date(prev.time).getTime();
			inRate = networkRatePerSecond(
				bytesFromSizeString(prev.value.inputMb),
				currIn,
				prevTimeMs,
				currTimeMs,
			);
			outRate = networkRatePerSecond(
				bytesFromSizeString(prev.value.outputMb),
				currOut,
				prevTimeMs,
				currTimeMs,
			);
		}

		return { time: item.time, name: `Point ${index + 1}`, inRate, outRate };
	});

	return (
		<ChartContainer config={chartConfig} className="mt-4 h-[10rem] w-full">
			<AreaChart
				data={transformedData}
				margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id="fillNetIn" x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="5%"
							stopColor="var(--color-inRate)"
							stopOpacity={0.8}
						/>
						<stop
							offset="95%"
							stopColor="var(--color-inRate)"
							stopOpacity={0.1}
						/>
					</linearGradient>
					<linearGradient id="fillNetOut" x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="5%"
							stopColor="var(--color-outRate)"
							stopOpacity={0.8}
						/>
						<stop
							offset="95%"
							stopColor="var(--color-outRate)"
							stopOpacity={0.1}
						/>
					</linearGradient>
				</defs>
				<CartesianGrid vertical={false} />
				<YAxis
					tickLine={false}
					axisLine={false}
					tickFormatter={(value) => formatNetworkRate(value)}
				/>
				<ChartTooltip
					cursor={false}
					content={
						<ChartTooltipContent
							labelFormatter={(_, payload) => {
								const time = payload?.[0]?.payload?.time;
								return time ? format(new Date(time), "PPpp") : "";
							}}
							formatter={(value, name) => {
								const label = name === "inRate" ? "In" : "Out";
								return [formatNetworkRate(Number(value) || 0), label];
							}}
						/>
					}
				/>
				<Area
					type="monotone"
					dataKey="inRate"
					stroke="var(--color-inRate)"
					fill="url(#fillNetIn)"
					strokeWidth={2}
				/>
				<Area
					type="monotone"
					dataKey="outRate"
					stroke="var(--color-outRate)"
					fill="url(#fillNetOut)"
					strokeWidth={2}
				/>
				<ChartLegend content={<ChartLegendContent />} />
			</AreaChart>
		</ChartContainer>
	);
};
