import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export async function generateSHA256Hash(text: string) {
	const encoder = new TextEncoder();
	const data = encoder.encode(text);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatTimestamp(timestamp: string | number) {
	try {
		// Si es un string ISO, lo parseamos directamente
		if (typeof timestamp === "string" && timestamp.includes("T")) {
			const date = new Date(timestamp);
			if (!Number.isNaN(date.getTime())) {
				return date.toLocaleString();
			}
		}
		return "Fecha inválida";
	} catch {
		return "Fecha inválida";
	}
}

/**
 * Throughput (bytes/second) between two cumulative byte counters sampled at two
 * points in time. The monitoring service reports network counters as totals
 * since boot, so a chart must derive the rate from consecutive samples rather
 * than plotting the raw (ever-increasing) total. Counter resets (reboot /
 * service restart) and zero/negative time gaps clamp to 0 instead of spiking.
 */
export function networkRatePerSecond(
	prevBytes: number,
	currBytes: number,
	prevTimeMs: number,
	currTimeMs: number,
): number {
	const dtSeconds = (currTimeMs - prevTimeMs) / 1000;
	if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return 0;
	const delta = currBytes - prevBytes;
	if (!Number.isFinite(delta) || delta < 0) return 0;
	return delta / dtSeconds;
}

const BYTE_UNIT_FACTORS: Record<string, number> = {
	b: 1,
	// docker stats NetIO/BlockIO report SI (1000-based) units
	kb: 1e3,
	mb: 1e6,
	gb: 1e9,
	tb: 1e12,
	pb: 1e15,
	eb: 1e18,
	// IEC (1024-based) variants, defensively
	kib: 1024,
	mib: 1024 ** 2,
	gib: 1024 ** 3,
	tib: 1024 ** 4,
	pib: 1024 ** 5,
	eib: 1024 ** 6,
};

/**
 * Normalises a (value, unit) pair from docker stats (e.g. `1.5`, `"kB"`) to a
 * byte count. The monitoring service splits docker's NetIO/BlockIO strings into
 * a number + a unit string that varies per sample, so any series built from the
 * raw numbers must first be converted to a common unit (bytes). Unknown units
 * fall back to bytes.
 */
export function bytesFromDockerSize(value: number, unit: string): number {
	if (!Number.isFinite(value)) return 0;
	const factor = BYTE_UNIT_FACTORS[(unit ?? "").trim().toLowerCase()] ?? 1;
	return value * factor;
}

/**
 * Human-readable network throughput from a bytes/second value, scaling the unit
 * (B/s → KB/s → MB/s → GB/s) so the number stays readable at any magnitude.
 */
export function formatNetworkRate(bytesPerSecond: number): string {
	if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 B/s";
	const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
	let value = bytesPerSecond;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const decimals = unitIndex === 0 || value >= 100 ? 0 : 1;
	return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function getFallbackAvatarInitials(
	fullName: string | undefined,
): string {
	if (typeof fullName === "undefined" || fullName === "") return "CN";
	const [name = "", surname = ""] = fullName.split(" ");
	if (surname === "") {
		return name.substring(0, 2).toUpperCase();
	}
	return (name.charAt(0) + surname.charAt(0)).toUpperCase();
}
