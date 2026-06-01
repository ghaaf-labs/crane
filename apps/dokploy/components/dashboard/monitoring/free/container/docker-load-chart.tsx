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
import type { DockerStatsJSON } from "./show-free-container-monitoring";

interface Props {
	accumulativeData: DockerStatsJSON["loadavg"];
}

const chartConfig = {
	load1: {
		label: "Load (1m)",
		color: "hsl(var(--chart-1))",
	},
} satisfies ChartConfig;

export const DockerLoadChart = ({ accumulativeData }: Props) => {
	// 1-minute load average over time. Load is meaningful relative to core
	// count: load1 ≈ cores means the host is fully busy, > cores means queued.
	const transformedData = accumulativeData.map((item, index) => ({
		time: item.time,
		name: `Point ${index + 1}`,
		load1: item.value.load1,
	}));

	return (
		<ChartContainer config={chartConfig} className="mt-4 h-[10rem] w-full">
			<AreaChart
				data={transformedData}
				margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id="fillLoad" x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="5%"
							stopColor="var(--color-load1)"
							stopOpacity={0.8}
						/>
						<stop
							offset="95%"
							stopColor="var(--color-load1)"
							stopOpacity={0.1}
						/>
					</linearGradient>
				</defs>
				<CartesianGrid vertical={false} />
				<YAxis tickLine={false} axisLine={false} />
				<ChartTooltip
					cursor={false}
					content={
						<ChartTooltipContent
							labelFormatter={(_, payload) => {
								const time = payload?.[0]?.payload?.time;
								return time ? format(new Date(time), "PPpp") : "";
							}}
							formatter={(value) => [`${value}`, "Load (1m)"]}
						/>
					}
				/>
				<Area
					type="monotone"
					dataKey="load1"
					stroke="var(--color-load1)"
					fill="url(#fillLoad)"
					strokeWidth={2}
				/>
				<ChartLegend content={<ChartLegendContent />} />
			</AreaChart>
		</ChartContainer>
	);
};
