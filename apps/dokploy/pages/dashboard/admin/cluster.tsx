import { IS_CLOUD, isInstanceAdmin, validateRequest } from "@crane/server";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { ShowNodes } from "@/components/dashboard/settings/cluster/nodes/show-nodes";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { appRouter } from "@/server/api/root";

const Page = () => {
	return (
		<div className="flex flex-col gap-4 w-full">
			<ShowNodes />
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Nodes">{page}</DashboardLayout>;
};

// Crane: the Swarm cluster is instance-wide infrastructure, so it lives in the
// Admin section and is gated to the single instance owner (root).
export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { req, res } = ctx;
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
	if (!(await isInstanceAdmin(user.id))) {
		return {
			redirect: { permanent: false, destination: "/dashboard/home" },
		};
	}
	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});
	await helpers.user.get.prefetch();

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}
