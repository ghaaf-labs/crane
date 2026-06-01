import {
	type DockerNode,
	execAsync,
	execAsyncRemote,
	findServerById,
	getRemoteDocker,
} from "@crane/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import { getLocalServerIp } from "@/server/wss/terminal";
import { createTRPCRouter, withPermission } from "../trpc";

export const clusterRouter = createTRPCRouter({
	getNodes: withPermission("server", "read")
		.input(
			z.object({
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (input.serverId) {
				const targetServer = await findServerById(input.serverId);
				if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You don't have access to this server.",
					});
				}
			}
			try {
				const docker = await getRemoteDocker(input.serverId);
				const workers: DockerNode[] = await docker.listNodes();
				return workers;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// docker.listNodes() throws when the host isn't a swarm manager
				// ("node is not part of a swarm" / "not a swarm manager", HTTP 503).
				// Treat only that as an empty list so the cluster page renders; surface
				// any other Docker failure (daemon down, connection/cred errors) so the
				// operator gets an actionable signal instead of a silent empty list.
				if (/swarm/i.test(message)) {
					console.warn(`cluster.getNodes: ${message}`);
					return [] as DockerNode[];
				}
				throw error;
			}
		}),

	removeWorker: withPermission("server", "delete")
		.input(
			z.object({
				nodeId: z.string(),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (input.serverId) {
				const targetServer = await findServerById(input.serverId);
				if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You don't have access to this server.",
					});
				}
			}
			try {
				const drainCommand = `docker node update --availability drain ${input.nodeId}`;
				const removeCommand = `docker node rm ${input.nodeId} --force`;

				if (input.serverId) {
					await execAsyncRemote(input.serverId, drainCommand);
					await execAsyncRemote(input.serverId, removeCommand);
				} else {
					await execAsync(drainCommand);
					await execAsync(removeCommand);
				}
				await audit(ctx, {
					action: "delete",
					resourceType: "cluster",
					resourceId: input.nodeId,
					resourceName: input.nodeId,
				});
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error removing the node",
					cause: error,
				});
			}
		}),

	addWorker: withPermission("server", "create")
		.input(
			z.object({
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (input.serverId) {
				const targetServer = await findServerById(input.serverId);
				if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You don't have access to this server.",
					});
				}
			}
			const docker = await getRemoteDocker(input.serverId);
			const result = await docker.swarmInspect();
			const docker_version = await docker.version();

			let ip = await getLocalServerIp();
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				ip = server?.ipAddress;
			}

			return {
				command: `docker swarm join --token ${result.JoinTokens.Worker} ${ip}:2377`,
				version: docker_version.Version,
			};
		}),

	addManager: withPermission("server", "create")
		.input(
			z.object({
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (input.serverId) {
				const targetServer = await findServerById(input.serverId);
				if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You don't have access to this server.",
					});
				}
			}
			const docker = await getRemoteDocker(input.serverId);
			const result = await docker.swarmInspect();
			const docker_version = await docker.version();

			let ip = await getLocalServerIp();
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				ip = server?.ipAddress;
			}
			return {
				command: `docker swarm join --token ${result.JoinTokens.Manager} ${ip}:2377`,
				version: docker_version.Version,
			};
		}),
});
