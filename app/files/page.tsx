import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/Badge";
import { FilesManager } from "@/components/FilesManager";
import { Reveal } from "@/components/Reveal";
import { requireActiveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const user = await requireActiveSession();

  return (
    <AppShell user={{ email: user.email, role: user.role }} active="/files">
      <section className="pt-10 sm:pt-14 pb-16">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">
                Team Files · Google Drive Storage
              </p>
              <Badge tone="live" className="text-[10px]">
                Live
              </Badge>
            </div>
            <h1
              className="mt-3 animate-fade-up font-display text-4xl font-bold tracking-[-0.02em] sm:text-5xl"
              style={{ animationDelay: "90ms" }}
            >
              Files.
            </h1>
          </div>
        </div>

        <p
          className="mt-4 max-w-2xl animate-fade-up text-[15px] leading-relaxed text-steel"
          style={{ animationDelay: "160ms" }}
        >
          Every team file, one browser. Upload anything, preview and download
          individual files or whole folders as zip, and move what you no
          longer need to Drive trash — all inside your team&apos;s dedicated
          Google Drive folder.
        </p>

        {/* Interactive manager */}
        <Reveal delay={200} className="mt-8">
          <FilesManager />
        </Reveal>
      </section>
    </AppShell>
  );
}
