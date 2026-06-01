import { IS_CLOUD, isInstanceAdmin, validateRequest } from "@crane/server";
import type { GetServerSidePropsContext } from "next";

// Crane: the Cluster moved to the instance-wide Admin section
// (/dashboard/admin/cluster). This stub preserves the old deep link: instance
// owners are redirected to the new path, everyone else to home.
const Page = () => null;

export default Page;

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
	return {
		redirect: {
			permanent: false,
			destination: (await isInstanceAdmin(user.id))
				? "/dashboard/admin/cluster"
				: "/dashboard/home",
		},
	};
}
