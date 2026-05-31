package monitoring

import (
	"testing"

	"github.com/ghaaf-labs/crane/apps/monitoring/database"
)

// Characterization test for ConvertToSystemMetrics: pins the string formatting
// of the /metrics response, including the higher %.3f precision used for the
// cumulative network counters (so the UI can derive an accurate per-second
// rate from consecutive samples).
func TestConvertToSystemMetrics_Formatting(t *testing.T) {
	in := database.ServerMetric{
		Timestamp:        "2026-06-01T00:00:00Z",
		CPU:              24.567,
		CPUModel:         "Apple M1 Pro",
		CPUCores:         8,
		CPUPhysicalCores: 1,
		CPUSpeed:         3228.0,
		OS:               "darwin",
		Distro:           "darwin",
		Kernel:           "23.4.0",
		Arch:             "arm64",
		MemUsed:          81.9,
		MemUsedGB:        13.111,
		MemTotal:         16.0,
		Uptime:           752232,
		DiskUsed:         89.34,
		TotalDisk:        460.4,
		NetworkIn:        54.7777,
		NetworkOut:       31.0,
	}

	out := ConvertToSystemMetrics(in)

	// 2-decimal fields
	if out.CPU != "24.57" {
		t.Errorf("CPU = %q, want \"24.57\"", out.CPU)
	}
	if out.MemUsed != "81.90" {
		t.Errorf("MemUsed = %q, want \"81.90\"", out.MemUsed)
	}
	if out.MemUsedGB != "13.11" {
		t.Errorf("MemUsedGB = %q, want \"13.11\"", out.MemUsedGB)
	}
	if out.DiskUsed != "89.34" {
		t.Errorf("DiskUsed = %q, want \"89.34\"", out.DiskUsed)
	}
	if out.TotalDisk != "460.40" {
		t.Errorf("TotalDisk = %q, want \"460.40\"", out.TotalDisk)
	}

	// 3-decimal network fields (finer resolution for rate derivation)
	if out.NetworkIn != "54.778" {
		t.Errorf("NetworkIn = %q, want \"54.778\"", out.NetworkIn)
	}
	if out.NetworkOut != "31.000" {
		t.Errorf("NetworkOut = %q, want \"31.000\"", out.NetworkOut)
	}

	// passthrough fields
	if out.CPUModel != "Apple M1 Pro" || out.CPUCores != 8 || out.Arch != "arm64" {
		t.Errorf("passthrough mismatch: %q/%d/%q", out.CPUModel, out.CPUCores, out.Arch)
	}
	if out.Uptime != 752232 || out.Timestamp != "2026-06-01T00:00:00Z" {
		t.Errorf("uptime/timestamp mismatch: %d/%q", out.Uptime, out.Timestamp)
	}
}
