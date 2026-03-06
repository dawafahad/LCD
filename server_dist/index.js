var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";

// server/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  insertLcdSchema: () => insertLcdSchema,
  insertUserSchema: () => insertUserSchema,
  lcdInventory: () => lcdInventory,
  updateLcdSchema: () => updateLcdSchema,
  users: () => users
});
import { sql } from "drizzle-orm";
import { boolean, numeric, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var lcdInventory = pgTable("lcd_inventory", {
  id: text("id").primaryKey(),
  brand: text("brand").notNull().default(""),
  lcdName: text("lcd_name").notNull(),
  compatibleModels: text("compatible_models").array().notNull().default(sql`'{}'`),
  supplier: text("supplier").notNull().default(""),
  purchaseRate: numeric("purchase_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull().default("0"),
  inStock: boolean("in_stock").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
var insertLcdSchema = createInsertSchema(lcdInventory).omit({
  createdAt: true
});
var updateLcdSchema = insertLcdSchema.partial().required({ id: true });

// server/db.ts
var pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err.message);
});
var db = drizzle(pool, { schema: schema_exports });

// server/routes.ts
import { eq } from "drizzle-orm";
async function registerRoutes(app2) {
  app2.get("/api/lcds", async (_req, res) => {
    try {
      const rows = await db.select().from(lcdInventory).orderBy(lcdInventory.createdAt);
      res.json(rows);
    } catch (err) {
      console.error("GET /api/lcds error:", err);
      res.status(500).json({ message: "Failed to fetch LCD inventory" });
    }
  });
  app2.post("/api/lcds", async (req, res) => {
    try {
      const body = req.body;
      const [row] = await db.insert(lcdInventory).values({
        id: body.id,
        brand: body.brand ?? "",
        lcdName: body.lcdName,
        compatibleModels: body.compatibleModels ?? [],
        supplier: body.supplier ?? "",
        purchaseRate: String(body.purchaseRate ?? 0),
        sellingPrice: String(body.sellingPrice ?? 0),
        inStock: body.inStock ?? true
      }).returning();
      res.status(201).json(row);
    } catch (err) {
      console.error("POST /api/lcds error:", err);
      res.status(500).json({ message: "Failed to create LCD entry" });
    }
  });
  app2.put("/api/lcds/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body;
      const [row] = await db.update(lcdInventory).set({
        brand: body.brand,
        lcdName: body.lcdName,
        compatibleModels: body.compatibleModels,
        supplier: body.supplier,
        purchaseRate: body.purchaseRate !== void 0 ? String(body.purchaseRate) : void 0,
        sellingPrice: body.sellingPrice !== void 0 ? String(body.sellingPrice) : void 0,
        inStock: body.inStock
      }).where(eq(lcdInventory.id, id)).returning();
      if (!row) return res.status(404).json({ message: "LCD not found" });
      res.json(row);
    } catch (err) {
      console.error("PUT /api/lcds/:id error:", err);
      res.status(500).json({ message: "Failed to update LCD entry" });
    }
  });
  app2.patch("/api/lcds/:id/stock", async (req, res) => {
    try {
      const { id } = req.params;
      const { inStock } = req.body;
      const [row] = await db.update(lcdInventory).set({ inStock }).where(eq(lcdInventory.id, id)).returning();
      if (!row) return res.status(404).json({ message: "LCD not found" });
      res.json(row);
    } catch (err) {
      console.error("PATCH /api/lcds/:id/stock error:", err);
      res.status(500).json({ message: "Failed to update stock status" });
    }
  });
  app2.delete("/api/lcds/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(lcdInventory).where(eq(lcdInventory.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/lcds/:id error:", err);
      res.status(500).json({ message: "Failed to delete LCD entry" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
