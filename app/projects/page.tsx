import { desc, eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/Badge";
import { ProjectsManager, type ProjectItem } from "@/components/ProjectsManager";
import { Reveal } from "@/components/Reveal";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requireActiveSession();

  let initialProjects: ProjectItem[] = [];

  try {
    const rows = await db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        codebaseDriveId: projects.codebaseDriveId,
        codebaseFileName: projects.codebaseFileName,
        codebaseFileSize: projects.codebaseFileSize,
        previewDriveId: projects.previewDriveId,
        previewFileName: projects.previewFileName,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        userId: projects.userId,
        userEmail: users.email,
        userRole: users.role,
        userDisplayName: users.displayName,
        userAvatarDriveId: users.avatarDriveId,
      })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .orderBy(desc(projects.createdAt));

    initialProjects = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  } catch (err) {
    console.error("[ProjectsPage] Error querying projects:", err);
  }

  return (
    <AppShell
      user={{
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        avatarDriveId: user.avatarDriveId,
      }}
      active="/projects"
    >
      <section className="pt-10 sm:pt-14 pb-16">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">
                Code Packages · Google Drive Storage
              </p>
              <Badge tone="live" className="text-[10px]">
                Live
              </Badge>
            </div>
            <h1
              className="mt-3 animate-fade-up font-display text-4xl font-bold tracking-[-0.02em] sm:text-5xl"
              style={{ animationDelay: "90ms" }}
            >
              Projects.
            </h1>
          </div>
        </div>

        <p
          className="mt-4 max-w-2xl animate-fade-up text-[15px] leading-relaxed text-steel"
          style={{ animationDelay: "160ms" }}
        >
          Publish, share, and download project files of any type — or entire
          folder trees with their structure preserved — with preview snapshots. All files are securely stored in your team&apos;s dedicated
          Google Drive backend.
        </p>

        {/* Interactive Manager */}
        <Reveal delay={200} className="mt-8">
          <ProjectsManager
            initialProjects={initialProjects}
            currentUser={{
              id: user.id,
              email: user.email,
              role: user.role,
              displayName: user.displayName ?? null,
            }}
          />
        </Reveal>
      </section>
    </AppShell>
  );
}
