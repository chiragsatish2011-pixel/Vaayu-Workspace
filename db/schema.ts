import {
  boolean,
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
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("member"),
  // True when the account owner must pick their own password before using
  // the workspace (accounts created by an admin start this way).
  // Existing accounts default to false so nobody is locked out by migration.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
