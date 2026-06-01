import { apiUpdateUser } from "@crane/server/db/schema";
import { describe, expect, it } from "vitest";

// Crane: the instance-owner (root) flag must be server-controlled only. It must
// never be settable through the user-update input schema, or any authenticated
// user could grant themselves root via the profile-update mutation.
describe("apiUpdateUser does not accept isInstanceAdmin", () => {
	it("strips a smuggled isInstanceAdmin field", () => {
		const parsed = apiUpdateUser.parse({
			email: "user@example.com",
			firstName: "Mallory",
			// Attempt to escalate to instance owner via mass assignment.
			isInstanceAdmin: true,
		} as Record<string, unknown>);
		expect(parsed).not.toHaveProperty("isInstanceAdmin");
	});

	it("still accepts the legitimate profile fields", () => {
		const parsed = apiUpdateUser.parse({
			email: "user@example.com",
			firstName: "Alice",
			lastName: "Smith",
		});
		expect(parsed.email).toBe("user@example.com");
		expect(parsed.firstName).toBe("Alice");
		expect(parsed.lastName).toBe("Smith");
	});
});
