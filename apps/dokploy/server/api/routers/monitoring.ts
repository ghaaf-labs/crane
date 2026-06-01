import {
	getHostDockerSummary,
	listAllServices,
	listOrgServices,
} from "@crane/server";
import {
	adminInstanceProcedure,
	createTRPCRouter,
	withPermission,
} from "../trpc";

export const monitoringRouter = createTRPCRouter({
	// Organization-scoped: the active org's own services only. The
	// "monitoring" permission resolves true for owner/admin and is bypassed for
	// enterprise resources, but the data is still scoped to the active org here.
	listOrgServices: withPermission("monitoring", "read").query(({ ctx }) =>
		listOrgServices(ctx.session.activeOrganizationId),
	),
	// Instance-wide: every org's services. Gated to the instance owner (root).
	listAllServices: adminInstanceProcedure.query(() => listAllServices()),
	// Instance-wide host Docker overview (container/image counts). Owner-only.
	hostDockerSummary: adminInstanceProcedure.query(() => getHostDockerSummary()),
});
