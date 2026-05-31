package containers

import "testing"

// Characterization tests for processContainerMetrics: they pin how the raw
// `docker stats` strings are parsed into numeric metrics + units, so the
// behavior is locked before any future refactor (incl. a Rust port).

func TestProcessContainerMetrics_TypicalSample(t *testing.T) {
	c := Container{
		CPUPerc:  "83.76%",
		MemPerc:  "0.03%",
		MemUsage: "2.262MiB / 7.654GiB",
		NetIO:    "306B / 0B",
		BlockIO:  "28.7kB / 0B",
		ID:       "abc123",
		Name:     "my-app",
	}

	m := processContainerMetrics(c)

	if m.CPU != 83.76 {
		t.Errorf("CPU = %v, want 83.76", m.CPU)
	}
	if m.Memory.Percentage != 0.03 {
		t.Errorf("Memory.Percentage = %v, want 0.03", m.Memory.Percentage)
	}
	// MiB/GiB are relabeled to MB/GB
	if m.Memory.Used != 2.262 || m.Memory.UsedUnit != "MB" {
		t.Errorf("Memory used = %v %q, want 2.262 MB", m.Memory.Used, m.Memory.UsedUnit)
	}
	if m.Memory.Total != 7.654 || m.Memory.TotalUnit != "GB" {
		t.Errorf("Memory total = %v %q, want 7.654 GB", m.Memory.Total, m.Memory.TotalUnit)
	}
	if m.Network.Input != 306 || m.Network.InputUnit != "B" {
		t.Errorf("Network in = %v %q, want 306 B", m.Network.Input, m.Network.InputUnit)
	}
	if m.Network.Output != 0 || m.Network.OutputUnit != "B" {
		t.Errorf("Network out = %v %q, want 0 B", m.Network.Output, m.Network.OutputUnit)
	}
	if m.BlockIO.Read != 28.7 || m.BlockIO.ReadUnit != "kB" {
		t.Errorf("Block read = %v %q, want 28.7 kB", m.BlockIO.Read, m.BlockIO.ReadUnit)
	}
	if m.BlockIO.Write != 0 || m.BlockIO.WriteUnit != "B" {
		t.Errorf("Block write = %v %q, want 0 B", m.BlockIO.Write, m.BlockIO.WriteUnit)
	}
	if m.ID != "abc123" || m.Name != "my-app" || m.Container != "abc123" {
		t.Errorf("identity = %q/%q/%q", m.ID, m.Name, m.Container)
	}
}

func TestProcessContainerMetrics_GbNetwork(t *testing.T) {
	m := processContainerMetrics(Container{
		CPUPerc:  "5.00%",
		MemPerc:  "10.00%",
		MemUsage: "512MiB / 1GiB",
		NetIO:    "1.5GB / 250MB",
		BlockIO:  "0B / 0B",
	})
	if m.Network.Input != 1.5 || m.Network.InputUnit != "GB" {
		t.Errorf("Network in = %v %q, want 1.5 GB", m.Network.Input, m.Network.InputUnit)
	}
	if m.Network.Output != 250 || m.Network.OutputUnit != "MB" {
		t.Errorf("Network out = %v %q, want 250 MB", m.Network.Output, m.Network.OutputUnit)
	}
	if m.Memory.Used != 512 || m.Memory.UsedUnit != "MB" {
		t.Errorf("Memory used = %v %q, want 512 MB", m.Memory.Used, m.Memory.UsedUnit)
	}
}

func TestProcessContainerMetrics_MalformedDefaultsToZero(t *testing.T) {
	// A paused container reports "--" for CPU and may have empty IO strings.
	m := processContainerMetrics(Container{
		CPUPerc:  "--",
		MemPerc:  "--",
		MemUsage: "",
		NetIO:    "",
		BlockIO:  "",
	})
	if m.CPU != 0 {
		t.Errorf("CPU = %v, want 0 for unparsable input", m.CPU)
	}
	if m.Memory.Used != 0 || m.Memory.Total != 0 {
		t.Errorf("Memory = %v/%v, want 0/0 for empty MemUsage", m.Memory.Used, m.Memory.Total)
	}
	if m.Network.Input != 0 || m.Network.Output != 0 {
		t.Errorf("Network = %v/%v, want 0/0 for empty NetIO", m.Network.Input, m.Network.Output)
	}
}
