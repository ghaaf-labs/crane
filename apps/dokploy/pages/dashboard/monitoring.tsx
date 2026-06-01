import { IS_CLOUD } from "@crane/server/constants";
import { validateRequest } from "@crane/server/lib/auth";
import { hasPermission } from "@crane/server/services/permission";
import { Loader2 } from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { ServiceMonitoringPanel } from "@/components/dashboard/monitoring/free/service-monitoring-panel";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Card } from "@/components/ui/card";
import { api } from "@/utils/api";

// Organization-scoped monitoring: shows only the active organization's own
// services. Whole-machine host metrics are instance-wide and live on the Admin
// monitoring view (/dashboard/admin/monitoring), not here.
const Dashboard = () => {
	const { data: services = [], isPending } =
		api.monitoring.listOrgServices.useQuery();

	return (
		<div className="space-y-4 pb-10">
			{isPending ? (
				<Card className="bg-sidebar p-2.5 rounded-xl mx-auto items-center">
					<div className="rounded-xl bg-background flex shadow-md px-4 min-h-[50vh] justify-center items-center gap-2 text-muted-foreground">
						Loading...
						<Loader2 className="h-4 w-4 animate-spin" />
					</div>
				</Card>
			) : (
				<ServiceMonitoringPanel
					services={services}
					emptyMessage="No services in this organization yet. Deploy an application, database, or Compose stack to see its CPU, memory, network, and disk usage here."
				/>
			)}
		</div>
	);
};

export default Dashboard;

Dashboard.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	if (IS_CLOUD) {
		return {
			redirect: { permanent: false, destination: "/dashboard/home" },
		};
	}
	const { user, session } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: { permanent: false, destination: "/" },
		};
	}

	const canView = await hasPermission(
		{
			user: { id: user.id },
			session: { activeOrganizationId: session?.activeOrganizationId || "" },
		},
		{ monitoring: ["read"] },
	);

	if (!canView) {
		return {
			redirect: { permanent: false, destination: "/dashboard/home" },
		};
	}

	return { props: {} };
}
