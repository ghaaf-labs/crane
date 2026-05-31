import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import * as bcrypt from "bcrypt";

// OWASP-recommended argon2id parameters (2024 "second" profile, t>=2).
// memoryCost is in KiB (19456 KiB ~= 19 MiB).
const ARGON2_OPTIONS = {
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
} as const;

/** True when the stored hash is a legacy bcrypt hash ($2a$/$2b$/$2y$). */
export const isBcryptHash = (hash: string): boolean => /^\$2[aby]\$/.test(hash);

/** True when the stored hash is an argon2 hash ($argon2id$/$argon2i$/$argon2d$). */
export const isArgon2Hash = (hash: string): boolean =>
	hash.startsWith("$argon2");

/** Hash a plaintext password with argon2id. Always produces an argon2 hash. */
export const hashPassword = (password: string): Promise<string> =>
	argon2Hash(password, { ...ARGON2_OPTIONS, algorithm: 2 /* Argon2id */ });

/**
 * Verify a plaintext password against a stored hash of either format.
 * Returns ok plus needsRehash=true when the stored hash is legacy bcrypt and
 * the password was correct, so callers can opportunistically upgrade it.
 */
export const verifyPassword = async ({
	hash,
	password,
}: {
	hash: string;
	password: string;
}): Promise<{ ok: boolean; needsRehash: boolean }> => {
	if (isArgon2Hash(hash)) {
		const ok = await argon2Verify(hash, password).catch(() => false);
		return { ok, needsRehash: false };
	}
	if (isBcryptHash(hash)) {
		const ok = bcrypt.compareSync(password, hash);
		return { ok, needsRehash: ok };
	}
	return { ok: false, needsRehash: false };
};
