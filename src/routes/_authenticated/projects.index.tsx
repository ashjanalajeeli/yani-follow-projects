import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Plus, FolderKanban } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — Yani" }] }),
  component: ProjectsList,
});

function ProjectsList() {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">All your AI-generated roadmaps.</p>
        </div>
        <Link to="/projects/new">
          <Button className="gap-2"><Plus className="size-4" /> New project</Button>
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : projects.length === 0 ? (
        <Card className="p-10 text-center">
          <FolderKanban className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="mb-4 text-muted-foreground">No projects yet.</p>
          <Link to="/projects/new"><Button>Create your first project</Button></Link>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} to="/projects/$id" params={{ id: p.id }}>
              <Card className="p-5 transition hover:border-primary/50">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="line-clamp-1 font-semibold">{p.name}</h3>
                  <Badge variant="outline" className="capitalize">{p.status}</Badge>
                </div>
                <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{p.description || "No description"}</p>
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{p.complexity ?? "—"} complexity</span><span>{p.progress}%</span>
                  </div>
                  <Progress value={p.progress} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
