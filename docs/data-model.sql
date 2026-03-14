-- Portable logical schema for a production-grade MCP Fabric registry.

CREATE TABLE services (
  service_id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  root_dir TEXT,
  owner_team TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scan_runs (
  scan_run_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(service_id),
  fingerprint TEXT NOT NULL,
  scanner_version TEXT NOT NULL,
  scanned_files INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  reused_cache INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(service_id),
  tool_name TEXT NOT NULL,
  title TEXT,
  description TEXT,
  http_method TEXT NOT NULL,
  path_template TEXT NOT NULL,
  framework TEXT,
  source_file TEXT,
  is_safe INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL,
  auth_type TEXT,
  inferred_auth INTEGER NOT NULL DEFAULT 0,
  input_schema_json TEXT NOT NULL,
  examples_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE operation_tags (
  operation_id TEXT NOT NULL REFERENCES operations(operation_id),
  tag TEXT NOT NULL,
  PRIMARY KEY (operation_id, tag)
);

CREATE TABLE resources (
  resource_uri TEXT PRIMARY KEY,
  service_id TEXT REFERENCES services(service_id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  description TEXT,
  content_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tool_versions (
  tool_version_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(operation_id),
  published_name TEXT NOT NULL,
  published_schema_json TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE metric_snapshots (
  metric_snapshot_id TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  services_scanned INTEGER NOT NULL,
  routes_discovered INTEGER NOT NULL,
  tools_generated INTEGER NOT NULL,
  cache_hits INTEGER NOT NULL,
  cache_misses INTEGER NOT NULL,
  scan_duration_ms REAL NOT NULL,
  payload_json TEXT
);
