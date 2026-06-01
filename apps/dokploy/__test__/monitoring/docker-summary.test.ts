import { summarizeDockerPs } from "@crane/server/services/docker";
import { describe, expect, it } from "vitest";

// Crane: pure summary derivation for the Admin host Docker overview.
describe("summarizeDockerPs", () => {
	it("counts total, running, and unique images", () => {
		const states = "running\nexited\nrunning\ncreated\nrunning";
		// docker images -q repeats an id across tags; count unique.
		const images = "abc123\ndef456\nabc123\nghi789";
		expect(summarizeDockerPs(states, images)).toEqual({
			totalContainers: 5,
			runningContainers: 3,
			images: 3,
		});
	});

	it("ignores blank lines / trailing whitespace", () => {
		expect(
			summarizeDockerPs("  running \n exited \n", "  abc \n\n def \n"),
		).toEqual({
			totalContainers: 2,
			runningContainers: 1,
			images: 2,
		});
	});

	it("returns zeros for empty output (no containers / no docker)", () => {
		expect(summarizeDockerPs("", "")).toEqual({
			totalContainers: 0,
			runningContainers: 0,
			images: 0,
		});
	});
});
