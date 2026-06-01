import { beforeEach, describe, expect, it, vi } from "vitest";

// Crane: unit tests for the self-host instance-owner (root) helper that gates
// the Admin section. The helper queries the user row and short-circuits on cloud.

let userToReturn: { isInstanceAdmin: boolean } | undefined;
let isCloud = false;

vi.mock("@crane/server/constants", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@crane/server/constants")>();
	return {
		...actual,
		get IS_CLOUD() {
			return isCloud;
		},
	};
});

vi.mock("@crane/server/db", () => ({
	db: {
		query: {
			user: {
				findFirst: vi.fn(() => Promise.resolve(userToReturn)),
			},
		},
	},
}));

const { isInstanceAdmin } = await import("@crane/server/services/user");

beforeEach(() => {
	vi.clearAllMocks();
	isCloud = false;
	userToReturn = undefined;
});

describe("isInstanceAdmin", () => {
	it("returns true for the flagged instance owner", async () => {
		userToReturn = { isInstanceAdmin: true };
		await expect(isInstanceAdmin("user-1")).resolves.toBe(true);
	});

	it("returns false for a user who is not the instance owner", async () => {
		userToReturn = { isInstanceAdmin: false };
		await expect(isInstanceAdmin("user-2")).resolves.toBe(false);
	});

	it("returns false when the user row is missing", async () => {
		userToReturn = undefined;
		await expect(isInstanceAdmin("ghost")).resolves.toBe(false);
	});

	it("always returns false on cloud, without touching the database", async () => {
		isCloud = true;
		// Even if a row says true, cloud has no single instance owner.
		userToReturn = { isInstanceAdmin: true };
		const { db } = await import("@crane/server/db");
		await expect(isInstanceAdmin("user-1")).resolves.toBe(false);
		expect(db.query.user.findFirst).not.toHaveBeenCalled();
	});
});
