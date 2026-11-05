// Runs once when the server starts: starts this instance's background worker and planner.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production") {
      // Without these, a container host loses data: the built-in database and file storage live
      // on the container's own disk.
      if (!process.env.DATABASE_URL) console.warn("[config] DATABASE_URL is not set; using the built-in database on local disk.");
      if (!process.env.GCS_BUCKET) console.warn("[config] GCS_BUCKET is not set; images are stored on local disk.");
      if (!process.env.SESSION_SECRET) console.warn("[config] SESSION_SECRET is not set; sessions are signed with ADMIN_PASSWORD.");
    }
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
