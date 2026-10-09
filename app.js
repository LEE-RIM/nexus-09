const configuration = window.NEXUS_CONFIG;
const configured = configuration &&
  typeof configuration.supabaseUrl === "string" &&
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(configuration.supabaseUrl) &&
  typeof configuration.supabaseAnonKey === "string" &&
  configuration.supabaseAnonKey.length > 20;

if (new URLSearchParams(location.search).get("demo") === "1" || !configured) {
  await import("./demo.js");
} else {
  await import("./real-app.js");
}
