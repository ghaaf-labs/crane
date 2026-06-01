import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ContainerFreeMonitoring } from "./container/show-free-container-monitoring";

export type MonitoredService = {
	appName: string;
	appType: "application" | "stack" | "docker-compose";
	name: string;
	projectName: string;
	organizationName?: string;
	status?: "idle" | "running" | "done" | "error";
};

const statusDotClass: Record<string, string> = {
	running: "bg-amber-500",
	done: "bg-emerald-500",
	error: "bg-red-500",
	idle: "bg-muted-foreground/40",
};

/**
 * Renders a picker over a set of services plus the selected service's container
 * monitoring. Used by the organization monitoring view (the org's own services)
 * and the Admin view (all services across orgs). Never renders host metrics —
 * those live only on the Admin host view (appName="dokploy").
 */
export const ServiceMonitoringPanel = ({
	services,
	emptyMessage,
	showOrg = false,
}: {
	services: MonitoredService[];
	emptyMessage: string;
	showOrg?: boolean;
}) => {
	const [selected, setSelected] = useState<string | null>(null);

	// Keep a valid selection as the list loads or changes.
	useEffect(() => {
		const first = services[0];
		if (!first) {
			setSelected(null);
		} else if (!services.some((s) => s.appName === selected)) {
			setSelected(first.appName);
		}
	}, [services, selected]);

	if (services.length === 0) {
		return (
			<Card className="bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md flex min-h-[30vh] items-center justify-center p-6 text-center text-sm text-muted-foreground">
					{emptyMessage}
				</div>
			</Card>
		);
	}

	const current = services.find((s) => s.appName === selected) ?? services[0];
	if (!current) {
		return null;
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap gap-2">
				{services.map((service) => {
					const isActive = service.appName === current.appName;
					return (
						<Button
							key={service.appName}
							type="button"
							variant={isActive ? "secondary" : "outline"}
							size="sm"
							className={cn("h-auto py-1.5", isActive && "border-primary")}
							onClick={() => setSelected(service.appName)}
						>
							{service.status && (
								<span
									className={cn(
										"size-2 rounded-full shrink-0",
										statusDotClass[service.status] ?? statusDotClass.idle,
									)}
									aria-label={service.status}
								/>
							)}
							<span className="flex flex-col items-start text-left leading-tight">
								<span className="font-medium">{service.name}</span>
								<span className="text-xs text-muted-foreground">
									{showOrg && service.organizationName
										? `${service.organizationName} · ${service.projectName}`
										: service.projectName}
								</span>
							</span>
						</Button>
					);
				})}
			</div>
			<Card className="h-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md p-6">
					<ContainerFreeMonitoring
						key={current.appName}
						appName={current.appName}
						appType={current.appType}
					/>
				</div>
			</Card>
		</div>
	);
};
