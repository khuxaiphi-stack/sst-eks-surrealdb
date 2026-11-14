import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { Surreal } from "surrealdb";

const app = new Hono();
const db = new Surreal();

let isConnected = false;

function getConfig() {
  return {
    url: process.env.SURREALDB_URL || "http://127.0.0.1:8000/rpc",
    user: process.env.SURREALDB_USER || "root",
    pass: process.env.SURREALDB_PASS || "root",
    ns: process.env.SURREALDB_NS || "test",
    db: process.env.SURREALDB_DB || "test",
  };
}

// Initialize database connection lazily and idempotently
async function ensureDB() {
  if (isConnected) return;
  const cfg = getConfig();
  await db.connect(cfg.url);
  if (cfg.user && cfg.pass) {
    try {
      await db.signin({
        username: cfg.user,
        password: cfg.pass,
      });
    } catch {
      // SurrealDB deployed with auth: false does not require signin
    }
  }
  await db.use({ namespace: cfg.ns, database: cfg.db });
  isConnected = true;
}

// Health check endpoint
app.get("/health", async (c) => {
  try {
    await ensureDB();
    return c.json({ status: "ok", backend: "surrealdb-tikv" });
  } catch (error) {
    return c.json({ status: "degraded", error: String(error) }, 503);
  }
});

// Create a user record
app.post("/users", async (c) => {
  try {
    await ensureDB();
    const body = await c.req.json();
    const user = await db.create("user", body);
    return c.json(user, 201);
  } catch (error) {
    return c.json({ error: "Failed to create user", details: String(error) }, 500);
  }
});

// List all users
app.get("/users", async (c) => {
  try {
    await ensureDB();
    const users = await db.select("user");
    return c.json(users);
  } catch (error) {
    return c.json({ error: "Failed to fetch users", details: String(error) }, 500);
  }
});

export const handler = handle(app);
export default app;
