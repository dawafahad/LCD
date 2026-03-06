import { sql } from "drizzle-orm";
import { boolean, numeric, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users (existing) ─────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── LCD Inventory ─────────────────────────────────────────────────────────────
export const lcdInventory = pgTable("lcd_inventory", {
  id: text("id").primaryKey(),
  brand: text("brand").notNull().default(""),
  lcdName: text("lcd_name").notNull(),
  compatibleModels: text("compatible_models").array().notNull().default(sql`'{}'`),
  supplier: text("supplier").notNull().default(""),
  purchaseRate: numeric("purchase_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull().default("0"),
  inStock: boolean("in_stock").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLcdSchema = createInsertSchema(lcdInventory).omit({
  createdAt: true,
});
export const updateLcdSchema = insertLcdSchema.partial().required({ id: true });

export type LcdInventory = typeof lcdInventory.$inferSelect;
export type InsertLcd = z.infer<typeof insertLcdSchema>;
export type UpdateLcd = z.infer<typeof updateLcdSchema>;
