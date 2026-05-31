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
