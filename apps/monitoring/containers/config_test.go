package containers

import "testing"

// Characterization tests for the container-selection logic that decides which
// containers the metrics service samples. monitorConfig is a package var, so
// we set it directly rather than going through LoadConfig (which reads global
// metrics config).

func TestShouldMonitorContainer_NilConfig(t *testing.T) {
	monitorConfig = nil
	if ShouldMonitorContainer("anything") {
		t.Error("want false when monitorConfig is nil")
	}
}

func TestShouldMonitorContainer_IncludeExclude(t *testing.T) {
	t.Cleanup(func() { monitorConfig = nil })

	cases := []struct {
		name      string
		include   []string
		exclude   []string
		container string
		want      bool
	}{
		{"empty config monitors everything", nil, nil, "any-container", true},
		{"include match", []string{"web"}, nil, "web-app-1", true},
		{"include miss", []string{"web"}, nil, "db-1", false},
		{"exclude wins over include", []string{"web"}, []string{"web-staging"}, "web-staging-1", false},
		{"exclude only", nil, []string{"redis"}, "redis-cache-1", false},
		{"exclude only, non-match passes", nil, []string{"redis"}, "web-1", true},
		{"substring include matches", []string{"elastic"}, nil, "my-elasticsearch-1", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			monitorConfig = &MonitoringConfig{
				IncludeServices: tc.include,
				ExcludeServices: tc.exclude,
			}
			if got := ShouldMonitorContainer(tc.container); got != tc.want {
				t.Errorf("ShouldMonitorContainer(%q) = %v, want %v", tc.container, got, tc.want)
			}
		})
	}
}

func TestGetServiceName(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"/my-app-1", "my-app"},
		{"my-app-1", "my-app"},
		{"redis", "redis"},
		{"/redis", "redis"},
		{"testing-elasticsearch-14649e-kibana-1", "testing-elasticsearch-14649e-kibana"},
	}
	for _, tc := range cases {
		if got := GetServiceName(tc.in); got != tc.want {
			t.Errorf("GetServiceName(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
