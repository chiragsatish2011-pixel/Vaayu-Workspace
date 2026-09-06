import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * NextAuth configuration — Credentials provider (email + password).
 *
 * - JWT session strategy; secret comes from NEXTAUTH_SECRET (never hardcoded).
 * - Passwords are verified with bcrypt against `users.password_hash`.
 *   Plaintext passwords are never stored or logged.
 * - The JWT/session carry `mustChangePassword` so mandatory password resets
 *   are enforced on every login (route guards re-check the database flag).
 * - Session cookie is httpOnly and `secure: true` in production (Vercel = HTTPS).
 * - Stateless: each authorize() call does one short DB lookup and returns.
 *   No in-memory stores, no background work — safe for Vercel serverless.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/signin" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.toLowerCase().trim();
        if (!email || !credentials.password) return null;

        try {
          const rows = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
          const user = rows[0];
          if (!user) {
            console.error(`[auth][authorize] login failed: unknown email (${email})`);
            return null;
          }

          const ok = await bcrypt.compare(
            credentials.password,
            user.passwordHash
          );
          if (!ok) {
            console.error(`[auth][authorize] login failed: wrong password (${email})`);
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
          };
        } catch (err) {
          console.error(`[auth][authorize] login error for (${email}):`, err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? token.sub ?? "";
        session.user.role = (token.role as "admin" | "member") ?? "member";
        session.user.mustChangePassword = token.mustChangePassword ?? false;
      }
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name: `${
        process.env.NODE_ENV === "production" ? "__Secure-" : ""
      }next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Vercel serves HTTPS, so require Secure cookies in production.
        // Local dev runs over HTTP, so Secure must stay off there.
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
};
