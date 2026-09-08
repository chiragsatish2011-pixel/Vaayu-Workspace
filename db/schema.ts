import {
  boolean,
  integer,
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
  displayName: text("display_name"),
  avatarDriveId: text("avatar_drive_id"),
  avatarFileName: text("avatar_file_name"),
  hasCompletedOnboarding: boolean("has_completed_onboarding").default(false).notNull(),
  department: text("department"),
  jobTitle: text("job_title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const checkpoints = pgTable("checkpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Checkpoint = typeof checkpoints.$inferSelect;
export type NewCheckpoint = typeof checkpoints.$inferInsert;

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  codebaseDriveId: text("codebase_drive_id").notNull(),
  codebaseFileName: text("codebase_file_name").notNull(),
  codebaseFileSize: text("codebase_file_size").notNull(),
  previewDriveId: text("preview_drive_id"),
  previewFileName: text("preview_file_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const callTypeEnum = pgEnum("call_type", ["voice", "video"]);
export const callContextEnum = pgEnum("call_context", ["standalone", "project", "checkpoint"]);

export const calls = pgTable("calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: callTypeEnum("type").notNull(),
  context: callContextEnum("context").notNull().default("standalone"),
  contextId: text("context_id"),
  dailyRoomName: text("daily_room_name").notNull().unique(),
  dailyRoomUrl: text("daily_room_url").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;

export const conversationTypeEnum = pgEnum("conversation_type", ["direct", "group"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: conversationTypeEnum("type").notNull(),
  // Group display name. NULL for direct conversations (name is derived
  // from the other participant at read time).
  name: text("name"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export const conversationParticipants = pgTable("conversation_participants", {
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  // Watermark for unread badges. NULL = never read.
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
});

export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert;

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Scopes every message to exactly one conversation. NULL only for
  // pre-conversation legacy rows from the old single global room — those
  // rows are never served by the new access-controlled routes.
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  contentJson: text("content_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

export const scheduledMeetings = pgTable("scheduled_meetings", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  organizerId: uuid("organizer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  callType: callTypeEnum("call_type").notNull(),
  rrule: text("rrule"),
  inviteeIds: text("invitee_ids").notNull().default("[]"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  excludedDates: text("excluded_dates").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScheduledMeeting = typeof scheduledMeetings.$inferSelect;
export type NewScheduledMeeting = typeof scheduledMeetings.$inferInsert;

