import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVICE_NAME = "abixell_one_operation";
const CONNECTION_OPTIONS = new Set([
  "application_name",
  "channel_binding",
  "client_encoding",
  "connect_timeout",
  "fallback_application_name",
  "gssencmode",
  "gsslib",
  "keepalives",
  "keepalives_count",
  "keepalives_idle",
  "keepalives_interval",
  "krbsrvname",
  "load_balance_hosts",
  "options",
  "replication",
  "requirepeer",
  "requiressl",
  "sslcert",
  "sslcompression",
  "sslcrl",
  "sslcrldir",
  "sslkey",
  "ssl_max_protocol_version",
  "ssl_min_protocol_version",
  "sslmode",
  "sslnegotiation",
  "sslpassword",
  "sslrootcert",
  "sslsni",
  "target_session_attrs",
  "tcp_user_timeout",
]);

/**
 * Materialize a protected libpq service file so callers can use every supported
 * PostgreSQL URI option without exposing credentials in a process argument.
 */
export async function withPostgresConnection(value, callback) {
  const settings = parseDatabaseUrl(value);
  const directory = await mkdtemp(join(tmpdir(), "abixell-pg-"));
  const serviceFile = join(directory, "pg_service.conf");
  const lines = [`[${SERVICE_NAME}]`];
  for (const [name, setting] of Object.entries(settings)) {
    lines.push(`${name}=${formatServiceValue(setting)}`);
  }
  await writeFile(serviceFile, `${lines.join("\n")}\n`, {
    mode: 0o600,
  });

  try {
    return await callback({
      databaseArgument: `service=${SERVICE_NAME}`,
      environment: {
        PGSERVICE: SERVICE_NAME,
        PGSERVICEFILE: serviceFile,
        PGHOST: "",
        PGPORT: "",
        PGUSER: "",
        PGDATABASE: "",
        PGPASSWORD: "",
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Database URL is invalid");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Database URL must use PostgreSQL");
  }

  const database = decodeURIComponent(
    url.pathname.replace(/^\//, ""),
  );
  const settings = {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    dbname: database,
  };

  const seen = new Set();
  for (const [name, optionValue] of url.searchParams) {
    if (!CONNECTION_OPTIONS.has(name)) {
      throw new Error(
        `Unsupported PostgreSQL URL option: ${name}`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `PostgreSQL URL option may appear only once: ${name}`,
      );
    }
    seen.add(name);
    settings[name] = optionValue;
  }

  if (!settings.host || !settings.dbname) {
    throw new Error(
      "Database URL must include a host and database name",
    );
  }
  for (const [name, setting] of Object.entries(settings)) {
    if (/[\0\r\n]/.test(setting)) {
      throw new Error(
        `PostgreSQL URL option contains an invalid control character: ${name}`,
      );
    }
  }
  return settings;
}

function formatServiceValue(value) {
  return value;
}
