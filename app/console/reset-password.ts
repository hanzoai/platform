import { findAdmin } from "@hanzo/platform";
import { updateAuthById } from "@hanzo/platform";
import { generateRandomPassword } from "@hanzo/platform";

(async () => {
	try {
		const randomPassword = await generateRandomPassword();

		const result = await findAdmin();

		const update = await updateAuthById(result.authId, {
			password: randomPassword.hashedPassword,
		});

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
