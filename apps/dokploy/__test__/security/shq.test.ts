import { shq } from "@crane/server/utils/providers/git";
import { describe, expect, it } from "vitest";

// Crane: golden + security tests for the POSIX single-quote shell escaper used to
// splice user/DB-controlled values into shell command strings. The invariant:
// the result is always wrapped in single quotes and every embedded single quote
// is escaped as '\'' so a value can never break out of the quoting and inject
// commands. (AGENTS.md §5 names shq as THE pattern for shell interpolation.)

describe("shq — exact output (golden)", () => {
	it("wraps an empty string", () => {
		expect(shq("")).toBe("''");
	});

	it("wraps a plain value", () => {
		expect(shq("main")).toBe("'main'");
	});

	it("keeps spaces inside one quoted token", () => {
		expect(shq("feature branch")).toBe("'feature branch'");
	});

	it("escapes a single embedded quote as '\\''", () => {
		expect(shq("it's")).toBe("'it'\\''s'");
	});

	it("escapes a lone single quote", () => {
		expect(shq("'")).toBe("''\\'''");
	});
});

describe("shq — neutralizes shell metacharacters (injection attempts)", () => {
	const attacks = [
		"$(rm -rf /)",
		"`whoami`",
		"a; rm -rf /",
		"a && reboot",
		"a | tee /etc/passwd",
		"$HOME",
		"${IFS}",
		"value\nrm -rf /",
		'a"b',
		"a\\b",
	];

	for (const attack of attacks) {
		it(`single-quotes ${JSON.stringify(attack)} verbatim`, () => {
			const out = shq(attack);
			expect(out.startsWith("'")).toBe(true);
			expect(out.endsWith("'")).toBe(true);
			// Removing every '\'' escape must leave a body with no stray single
			// quote — a stray quote is exactly what would let a payload break out.
			const body = out.slice(1, -1).split("'\\''").join("");
			expect(body.includes("'")).toBe(false);
		});
	}
});

describe("shq — round-trips through POSIX single-quote rules", () => {
	// Reversing the exact escaping must return the original input: strip the outer
	// quotes, then turn every '\'' escape back into a single quote.
	const decode = (quoted: string): string =>
		quoted.slice(1, -1).split("'\\''").join("'");
	for (const value of ["", "x", "it's", "'", "''", "a'b'c", "$(x) 'y'", " "]) {
		it(`round-trips ${JSON.stringify(value)}`, () => {
			expect(decode(shq(value))).toBe(value);
		});
	}
});
