import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { db } from "./db";
import { lcdInventory } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function registerRoutes(app: Express): Promise<Server> {

  // ── GET /api/lcds — fetch all entries ──────────────────────────────────────
  app.get("/api/lcds", async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(lcdInventory)
        .orderBy(lcdInventory.createdAt);
      res.json(rows);
    } catch (err) {
      console.error("GET /api/lcds error:", err);
      res.status(500).json({ message: "Failed to fetch LCD inventory" });
    }
  });

  // ── POST /api/lcds — create new entry ─────────────────────────────────────
  app.post("/api/lcds", async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const [row] = await db
        .insert(lcdInventory)
        .values({
          id: body.id,
          brand: body.brand ?? "",
          lcdName: body.lcdName,
          compatibleModels: body.compatibleModels ?? [],
          supplier: body.supplier ?? "",
          purchaseRate: String(body.purchaseRate ?? 0),
          sellingPrice: String(body.sellingPrice ?? 0),
          inStock: body.inStock ?? true,
        })
        .returning();
      res.status(201).json(row);
    } catch (err) {
      console.error("POST /api/lcds error:", err);
      res.status(500).json({ message: "Failed to create LCD entry" });
    }
  });

  // ── PUT /api/lcds/:id — update entry ──────────────────────────────────────
  app.put("/api/lcds/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const body = req.body;
      const [row] = await db
        .update(lcdInventory)
        .set({
          brand: body.brand,
          lcdName: body.lcdName,
          compatibleModels: body.compatibleModels,
          supplier: body.supplier,
          purchaseRate: body.purchaseRate !== undefined ? String(body.purchaseRate) : undefined,
          sellingPrice: body.sellingPrice !== undefined ? String(body.sellingPrice) : undefined,
          inStock: body.inStock,
        })
        .where(eq(lcdInventory.id, id))
        .returning();
      if (!row) return res.status(404).json({ message: "LCD not found" });
      res.json(row);
    } catch (err) {
      console.error("PUT /api/lcds/:id error:", err);
      res.status(500).json({ message: "Failed to update LCD entry" });
    }
  });

  // ── PATCH /api/lcds/:id/stock — toggle in_stock ───────────────────────────
  app.patch("/api/lcds/:id/stock", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { inStock } = req.body as { inStock: boolean };
      const [row] = await db
        .update(lcdInventory)
        .set({ inStock })
        .where(eq(lcdInventory.id, id))
        .returning();
      if (!row) return res.status(404).json({ message: "LCD not found" });
      res.json(row);
    } catch (err) {
      console.error("PATCH /api/lcds/:id/stock error:", err);
      res.status(500).json({ message: "Failed to update stock status" });
    }
  });

  // ── DELETE /api/lcds/:id — delete entry ───────────────────────────────────
  app.delete("/api/lcds/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await db.delete(lcdInventory).where(eq(lcdInventory.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/lcds/:id error:", err);
      res.status(500).json({ message: "Failed to delete LCD entry" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
