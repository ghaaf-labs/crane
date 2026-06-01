import { IS_CLOUD, isInstanceAdmin, validateRequest } from "@crane/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { ContainerFreeMonitoring } from "@/components/dashboard/monitoring/free/container/show-free-container-monitoring";
import { ServiceMonitoringPanel } from "@/components/dashboard/monitoring/free/service-monitoring-panel";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Card } from "@/components/ui/card";
import { api } from "@/utils/api";

// Instance-wide monitoring (Admin section, instance owner only): the host
// machine metrics plus every service across every organization.
const Page = () => {
	const { data: services = [] } = api.monitoring.listAllServices.useQuery();

	return (
		<div className="flex flex-col gap-8 pb-10">
			<section className="flex flex-col gap-3">
				<div>
					<h2 className="text-xl font-semibold">Host</h2>
					<p className="text-sm text-muted-foreground">
						Whole-machine usage for the server running Crane.
					</p>
				</div>
				<Card className="h-full bg-sidebar p-2.5 rounded-xl">
					<div className="rounded-xl bg-background shadow-md p-6">
						<ContainerFreeMonitoring appName="dokploy" />
					</div>
				</Card>
			</section>

			<section className="flex flex-col gap-3">
				<div>
					<h2 className="text-xl font-semibold">All services</h2>
					<p className="text-sm text-muted-foreground">
						Every deployed service across all organizations on this instance.
					</p>
				</div>
				<ServiceMonitoringPanel
					services={services}
					showOrg
					emptyMessage="No services deployed on this instance yet."
				/>
			</section>
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Monitoring">{page}</DashboardLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	if (IS_CLOUD) {
		return {
			redirect: { permanent: false, destination: "/dashboard/home" },
		};
	}
	const { user } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: { permanent: false, destination: "/" },
		};
	}
	if (!(await isInstanceAdmin(user.id))) {
		return {
			redirect: { permanent: false, destination: "/dashboard/home" },
		};
	}
	return { props: {} };
}
