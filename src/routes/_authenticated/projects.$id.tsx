import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  component: ProjectShell,
});

const TABS = [
  { to: "/projects/$id" as const, label: "Overview", match: (p: string, id: string) => p === `/projects/${id}` },
  { to: "/projects/$id/roadmap" as const, label: "Roadmap", match: (p: string, id: string) => p.startsWith(`/projects/${id}/roadmap`) },
  { to: "/projects/$id/kanban" as const, label: "Kanban", match: (p: string, id: string) => p.startsWith(`/projects/${id}/kanban`) },
  { to: "/projects/$id/checklist" as const, label: "Checklists", match: (p: string, id: string) => p.startsWith(`/projects/${id}/checklist`) },
  { to: "/projects/$id/files" as const, label: "Files", match: (p: string, id: string) => p.startsWith(`/projects/${id}/files`) },
];

function ProjectShell() {
  const { id } = Route.useParams();
  const location = useLocation();
  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("*").eq("id", id).single();
      return data;
    },
  });

  if (!project) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex flex-col">
      <div className="border-b border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-5 md:px-8">
          <Link to="/projects" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> Projects
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{project.name}</h1>
              {project.description && (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{project.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="capitalize">{project.status}</Badge>
                {project.project_type && <Badge variant="secondary">{project.project_type}</Badge>}
                {project.complexity && <Badge variant="secondary" className="capitalize">{project.complexity} complexity</Badge>}
                {project.generation_status !== "ready" && (
                  <Badge className="bg-warning/20 text-warning">
                    {project.generation_status === "analyzing" ? "Analyzing…" : project.generation_status === "roadmap" ? "Generating roadmap…" : project.generation_status}
                  </Badge>
                )}
              </div>
            </div>
            <div className="min-w-52">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress</span><span>{project.progress}%</span>
              </div>
              <Progress value={project.progress} />
            </div>
          </div>

          <nav className="mt-5 -mb-px flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const active = t.match(location.pathname, id);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  params={{ id }}
                  className={cn(
                    "border-b-2 px-3 py-2 text-sm transition",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <Outlet />
    </div>
  );
}
