import path, { join } from "node:path";
import { paths } from "@crane/server/constants";
import {
	findSSHKeyById,
	updateSSHKeyById,
} from "@crane/server/services/ssh-key";
import { execAsync, execAsyncRemote } from "../process/execAsync";

/**
 * Wrap a value in single quotes for safe POSIX-shell interpolation. Neutralizes
 * every shell metacharacter ($, backtick, ;, &, |, spaces, newlines, …) by
 * escaping embedded single quotes. Use for ALL user/DB-controlled values that
 * are spliced into a shell command string.
 */
export const shq = (value: string): string =>
	`'${value.replace(/'/g, "'\\''")}'`;

interface CloneGitRepository {
	appName: string;
	customGitUrl?: string | null;
	customGitBranch?: string | null;
	customGitSSHKeyId?: string | null;
	enableSubmodules?: boolean;
	serverId: string | null;
	type?: "application" | "compose";
	outputPathOverride?: string;
}

export const cloneGitRepository = async ({
	type = "application",
	...entity
}: CloneGitRepository) => {
	let command = "set -e;";
	const {
		appName,
		customGitUrl,
		customGitBranch,
		customGitSSHKeyId,
		enableSubmodules,
		serverId,
		outputPathOverride,
	} = entity;
	const { SSH_PATH, COMPOSE_PATH, APPLICATIONS_PATH } = paths(!!serverId);

	if (!customGitUrl || !customGitBranch) {
		command += `echo "Error: ❌ Repository not found"; exit 1;`;
		return command;
	}

	// Per-app key path instead of a shared, predictable /tmp/id_rsa (avoids the
	// cross-deploy race / key-overwrite between concurrent clones).
	const temporalKeyPath = path.join("/tmp", `id_rsa_${appName}`);

	if (customGitSSHKeyId) {
		const sshKey = await findSSHKeyById(customGitSSHKeyId);

		command += `
			echo ${shq(sshKey.privateKey)} > ${shq(temporalKeyPath)}
			chmod 600 ${shq(temporalKeyPath)};
			`;
	}
	const basePath = type === "compose" ? COMPOSE_PATH : APPLICATIONS_PATH;
	const outputPath = outputPathOverride ?? join(basePath, appName, "code");
	const knownHostsPath = path.join(SSH_PATH, "known_hosts");

	if (!isHttpOrHttps(customGitUrl)) {
		if (!customGitSSHKeyId) {
			command += `echo "Error: ❌ You are trying to clone a ssh repository without a ssh key, please set a ssh key"; exit 1;`;
			return command;
		}
		command += addHostToKnownHostsCommand(customGitUrl);
	}
	command += `rm -rf ${shq(outputPath)};`;
	command += `mkdir -p ${shq(outputPath)};`;
	command += `echo ${shq(`Cloning Repo Custom ${customGitUrl} to ${outputPath}: ✅`)};`;

	if (customGitSSHKeyId) {
		await updateSSHKeyById({
			sshKeyId: customGitSSHKeyId,
			lastUsedAt: new Date().toISOString(),
		});
	}

	if (customGitSSHKeyId) {
		const sshKey = await findSSHKeyById(customGitSSHKeyId);
		const { port } = sanitizeRepoPathSSH(customGitUrl);
		const gitSshCommand = `ssh -i ${temporalKeyPath}${port ? ` -p ${port}` : ""} -o UserKnownHostsFile=${knownHostsPath}`;
		command += `echo ${shq(sshKey.privateKey)} > ${shq(temporalKeyPath)};`;
		command += `chmod 600 ${shq(temporalKeyPath)};`;
		command += `export GIT_SSH_COMMAND=${shq(gitSshCommand)};`;
	}
	command += `if ! git clone --branch ${shq(customGitBranch)} --depth 1 ${enableSubmodules ? "--recurse-submodules" : ""} --progress ${shq(customGitUrl)} ${shq(outputPath)}; then
				echo ${shq(`❌ [ERROR] Fail to clone the repository ${customGitUrl}`)};
				exit 1;
			fi
			`;

	return command;
};

const isHttpOrHttps = (url: string): boolean => {
	const regex = /^https?:\/\//;
	return regex.test(url);
};

// const addHostToKnownHosts = async (repositoryURL: string) => {
// 	const { SSH_PATH } = paths();
// 	const { domain, port } = sanitizeRepoPathSSH(repositoryURL);
// 	const knownHostsPath = path.join(SSH_PATH, "known_hosts");

// 	const command = `ssh-keyscan -p ${port} ${domain} >> ${knownHostsPath}`;
// 	try {
// 		await execAsync(command);
// 	} catch (error) {
// 		console.error(`Error adding host to known_hosts: ${error}`);
// 		throw error;
// 	}
// };

const addHostToKnownHostsCommand = (repositoryURL: string) => {
	const { SSH_PATH } = paths(true);
	const { domain, port } = sanitizeRepoPathSSH(repositoryURL);
	const knownHostsPath = path.join(SSH_PATH, "known_hosts");

	return `ssh-keyscan -p ${port} ${shq(domain ?? "")} >> ${shq(knownHostsPath)};`;
};
const sanitizeRepoPathSSH = (input: string) => {
	const SSH_PATH_RE = new RegExp(
		[
			/^\s*/,
			/(?:(?<proto>[a-z]+):\/\/)?/,
			/(?:(?<user>[a-z_][a-z0-9_-]+)@)?/,
			/(?<domain>[^\s/?#:]+)/,
			/(?::(?<port>[0-9]{1,5}))?/,
			/(?:[/:](?<owner>[^\s/?#:]+))?/,
			/(?:[/:](?<repo>(?:[^\s?#:.]|\.(?!git\/?\s*$))+))/,
			/(?:.git)?\/?\s*$/,
		]
			.map((r) => r.source)
			.join(""),
		"i",
	);

	const found = input.match(SSH_PATH_RE);
	if (!found) {
		throw new Error(`Malformatted SSH path: ${input}`);
	}

	return {
		user: found.groups?.user ?? "git",
		domain: found.groups?.domain,
		port: Number(found.groups?.port ?? 22),
		owner: found.groups?.owner ?? "",
		repo: found.groups?.repo,
		get repoPath() {
			return `ssh://${this.user}@${this.domain}:${this.port}/${this.owner}${
				this.owner && "/"
			}${this.repo}.git`;
		},
	};
};

interface Props {
	appName: string;
	type?: "application" | "compose";
	serverId: string | null;
}

export const getGitCommitInfo = async ({
	appName,
	type = "application",
	serverId,
}: Props) => {
	const { COMPOSE_PATH, APPLICATIONS_PATH } = paths(!!serverId);
	const basePath = type === "compose" ? COMPOSE_PATH : APPLICATIONS_PATH;
	const outputPath = join(basePath, appName, "code");
	let stdoutResult = "";
	const result = {
		message: "",
		hash: "",
	};
	try {
		const gitCommand = `git -C ${outputPath} log -1 --pretty=format:"%H---DELIMITER---%B"`;
		if (serverId) {
			const { stdout } = await execAsyncRemote(serverId, gitCommand);
			stdoutResult = stdout.trim();
		} else {
			const { stdout } = await execAsync(gitCommand);
			stdoutResult = stdout.trim();
		}

		const parts = stdoutResult.split("---DELIMITER---");
		if (parts && parts.length === 2) {
			result.hash = parts[0]?.trim() || "";
			result.message = parts[1]?.trim() || "";
		}
	} catch (error) {
		console.error(`Error getting git commit info: ${error}`);
		return null;
	}
	return result;
};
