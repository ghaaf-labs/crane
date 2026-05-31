import { findOwner, generateRandomPassword } from "@crane/server";
import { db } from "@crane/server/db";
import { account } from "@crane/server/db/schema";
import { eq } from "drizzle-orm";

(async () => {
	try {
		const randomPassword = await generateRandomPassword();

		const result = await findOwner();

		const update = await db
			.update(account)
			.set({
				password: randomPassword.hashedPassword,
			})
			.where(eq(account.userId, result.userId));

		if (update) {
			console.log("Password reset successful");
			console.log("New password: ", randomPassword.randomPassword);
		} else {
			console.log("Password reset failed");
		}

		process.exit(0);
	} catch (error) {
		console.log("Error resetting password", error);
	}
})();
