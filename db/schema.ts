import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Role enum: "admin" | "member". New users default to "member".
export const roleEnum = pgEnum("role", ["admin", "member"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  // bcrypt hash of the user's password. NEVER store plaintext.
  // Only admins set passwords (admin panel); users have no self-service
  // password UI at all.
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
