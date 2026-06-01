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
	accumulativeData: DockerStatsJSON["swap"];
}

const chartConfig = {
	swapUsed: {
		label: "Swap Used (MB)",
		color: "hsl(var(--chart-5))",
	},
} satisfies ChartConfig;

export const DockerSwapChart = ({ accumulativeData }: Props) => {
	// Swap used (MB) over time. Sustained/rising swap usage signals memory
	// pressure (the host is paging to disk).
	const transformedData = accumulativeData.map((item, index) => ({
		time: item.time,
		name: `Point ${index + 1}`,
		swapUsed: item.value.swapUsed,
	}));

	return (
		<ChartContainer config={chartConfig} className="mt-4 h-[10rem] w-full">
			<AreaChart
				data={transformedData}
				margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id="fillSwap" x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="5%"
							stopColor="var(--color-swapUsed)"
							stopOpacity={0.8}
						/>
						<stop
							offset="95%"
							stopColor="var(--color-swapUsed)"
							stopOpacity={0.1}
						/>
					</linearGradient>
				</defs>
				<CartesianGrid vertical={false} />
				<YAxis
					tickLine={false}
					axisLine={false}
					tickFormatter={(value) => `${value} MB`}
				/>
				<ChartTooltip
					cursor={false}
					content={
						<ChartTooltipContent
							labelFormatter={(_, payload) => {
								const time = payload?.[0]?.payload?.time;
								return time ? format(new Date(time), "PPpp") : "";
							}}
							formatter={(value) => [`${value} MB`, "Swap Used"]}
						/>
					}
				/>
				<Area
					type="monotone"
					dataKey="swapUsed"
					stroke="var(--color-swapUsed)"
					fill="url(#fillSwap)"
					strokeWidth={2}
				/>
				<ChartLegend content={<ChartLegendContent />} />
			</AreaChart>
		</ChartContainer>
	);
};
