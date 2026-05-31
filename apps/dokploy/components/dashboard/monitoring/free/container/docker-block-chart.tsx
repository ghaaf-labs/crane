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
	accumulativeData: DockerStatsJSON["block"];
}

const chartConfig = {
	readRate: {
		label: "Read",
		color: "hsl(var(--chart-1))",
	},
	writeRate: {
		label: "Write",
		color: "hsl(var(--chart-2))",
	},
} satisfies ChartConfig;

export const DockerBlockChart = ({ accumulativeData }: Props) => {
	// readMb/writeMb are stored as cumulative docker BlockIO strings (e.g.
	// "1.2MB"). Normalise to bytes and derive a per-second disk throughput from
	// the delta to the previous sample.
	const transformedData = accumulativeData.map((item, index) => {
		const prev = index > 0 ? accumulativeData[index - 1] : undefined;
		const currRead = bytesFromSizeString(item.value.readMb);
		const currWrite = bytesFromSizeString(item.value.writeMb);
		const currTimeMs = new Date(item.time).getTime();

		let readRate = 0;
		let writeRate = 0;
		if (prev) {
			const prevTimeMs = new Date(prev.time).getTime();
			readRate = networkRatePerSecond(
				bytesFromSizeString(prev.value.readMb),
				currRead,
				prevTimeMs,
				currTimeMs,
			);
			writeRate = networkRatePerSecond(
				bytesFromSizeString(prev.value.writeMb),
				currWrite,
				prevTimeMs,
				currTimeMs,
			);
		}

		return {
			time: item.time,
			name: `Point ${index + 1}`,
			readRate,
			writeRate,
		};
	});

	return (
		<ChartContainer config={chartConfig} className="mt-4 h-[10rem] w-full">
			<AreaChart
				data={transformedData}
				margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id="fillBlockRead" x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="5%"
							stopColor="var(--color-readRate)"
							stopOpacity={0.8}
						/>
						<stop
							offset="95%"
							stopColor="var(--color-readRate)"
							stopOpacity={0.1}
						/>
					</linearGradient>
					<linearGradient id="fillBlockWrite" x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="5%"
							stopColor="var(--color-writeRate)"
							stopOpacity={0.8}
						/>
						<stop
							offset="95%"
							stopColor="var(--color-writeRate)"
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
								const label = name === "readRate" ? "Read" : "Write";
								return [formatNetworkRate(Number(value) || 0), label];
							}}
						/>
					}
				/>
				<Area
					type="monotone"
					dataKey="readRate"
					stroke="var(--color-readRate)"
					fill="url(#fillBlockRead)"
					strokeWidth={2}
				/>
				<Area
					type="monotone"
					dataKey="writeRate"
					stroke="var(--color-writeRate)"
					fill="url(#fillBlockWrite)"
					strokeWidth={2}
				/>
				<ChartLegend content={<ChartLegendContent />} />
			</AreaChart>
		</ChartContainer>
	);
};
