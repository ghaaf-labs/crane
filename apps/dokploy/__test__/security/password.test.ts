import {
	hashPassword,
	isArgon2Hash,
	isBcryptHash,
	verifyPassword,
} from "@crane/server/lib/password";
import * as bcrypt from "bcrypt";
import { describe, expect, it } from "vitest";

// Crane: characterization tests for the auth password layer — argon2id hashing
// with transparent verification of (and opportunistic upgrade from) legacy
// bcrypt hashes. Pins the security contract before any Rust port.

describe("hash-format detection", () => {
	it("recognizes the bcrypt variants ($2a/$2b/$2y)", () => {
		expect(isBcryptHash("$2a$10$abcdefghijklmnopqrstuv")).toBe(true);
		expect(isBcryptHash("$2b$12$abcdefghijklmnopqrstuv")).toBe(true);
		expect(isBcryptHash("$2y$10$abcdefghijklmnopqrstuv")).toBe(true);
	});

	it("rejects non-bcrypt strings", () => {
		expect(isBcryptHash("$argon2id$v=19$m=19456,t=2,p=1$abc")).toBe(false);
		expect(isBcryptHash("plaintext")).toBe(false);
		expect(isBcryptHash("")).toBe(false);
	});

	it("recognizes argon2 variants and rejects others", () => {
		expect(isArgon2Hash("$argon2id$v=19$m=19456,t=2,p=1$abc")).toBe(true);
		expect(isArgon2Hash("$argon2i$v=19$...")).toBe(true);
		expect(isArgon2Hash("$2b$12$abc")).toBe(false);
		expect(isArgon2Hash("nope")).toBe(false);
	});
});

describe("hashPassword (argon2id)", () => {
	it("produces an argon2id hash that verifies and never asks for rehash", async () => {
		const hash = await hashPassword("correct horse battery staple");
		expect(hash.startsWith("$argon2id$")).toBe(true);
		expect(isArgon2Hash(hash)).toBe(true);
		await expect(
			verifyPassword({ hash, password: "correct horse battery staple" }),
		).resolves.toEqual({ ok: true, needsRehash: false });
	});

	it("salts: the same password hashes to different digests", async () => {
		const [a, b] = await Promise.all([
			hashPassword("same"),
			hashPassword("same"),
		]);
		expect(a).not.toBe(b);
	});

	it("rejects a wrong password against an argon2 hash", async () => {
		const hash = await hashPassword("right");
		await expect(verifyPassword({ hash, password: "wrong" })).resolves.toEqual({
			ok: false,
			needsRehash: false,
		});
	});
});

describe("verifyPassword — legacy bcrypt", () => {
	it("verifies a correct password and flags it for rehash (upgrade)", async () => {
		const legacy = bcrypt.hashSync("legacy-secret", 10);
		expect(isBcryptHash(legacy)).toBe(true);
		await expect(
			verifyPassword({ hash: legacy, password: "legacy-secret" }),
		).resolves.toEqual({ ok: true, needsRehash: true });
	});

	it("rejects a wrong password against a bcrypt hash without flagging rehash", async () => {
		const legacy = bcrypt.hashSync("legacy-secret", 10);
		await expect(
			verifyPassword({ hash: legacy, password: "nope" }),
		).resolves.toEqual({ ok: false, needsRehash: false });
	});
});

describe("verifyPassword — robustness", () => {
	it("returns ok:false for an unrecognized hash format", async () => {
		await expect(
			verifyPassword({ hash: "not-a-real-hash", password: "x" }),
		).resolves.toEqual({ ok: false, needsRehash: false });
	});

	it("returns ok:false (never throws) for a malformed argon2 hash", async () => {
		await expect(
			verifyPassword({ hash: "$argon2id$garbage", password: "x" }),
		).resolves.toEqual({ ok: false, needsRehash: false });
	});
});
