import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, Plus, CheckCircle2, Clock, AlertTriangle, Rocket } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Yani" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [{ data: projects }, { data: tasks }] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("tasks").select("id, completed, status, due_date"),
      ]);
      return { projects: projects ?? [], tasks: tasks ?? [] };
    },
  });

  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const completed = tasks.filter((t) => t.completed).length;
  const overdue = tasks.filter((t) => !t.completed && t.due_date && new Date(t.due_date) < new Date()).length;

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your projects at a glance.</p>
        </div>
        <Link to="/projects/new">
          <Button className="gap-2"><Plus className="size-4" /> New project</Button>
        </Link>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={FolderKanban} label="Projects" value={projects.length} />
        <Stat icon={Clock} label="Open tasks" value={tasks.length - completed} />
        <Stat icon={CheckCircle2} label="Completed" value={completed} accent="success" />
        <Stat icon={AlertTriangle} label="Overdue" value={overdue} accent={overdue > 0 ? "destructive" : undefined} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent projects</h2>
        <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground">View all →</Link>
      </div>

      {projects.length === 0 ? (
        <Card className="p-10 text-center">
          <Rocket className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="mb-4 text-muted-foreground">No projects yet — start with an idea or upload a brief.</p>
          <Link to="/projects/new">
            <Button className="gap-2"><Plus className="size-4" /> Create your first project</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.slice(0, 6).map((p) => (
            <Link key={p.id} to="/projects/$id" params={{ id: p.id }}>
              <Card className="p-5 transition hover:border-primary/50">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="line-clamp-1 font-semibold">{p.name}</h3>
                  <Badge variant="outline" className="capitalize">{p.status}</Badge>
                </div>
                <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{p.description || "No description"}</p>
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progress</span><span>{p.progress}%</span>
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

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent?: "success" | "destructive";
}) {
  const tone =
    accent === "success"
      ? "text-success bg-success/10"
      : accent === "destructive"
        ? "text-destructive bg-destructive/10"
        : "text-primary bg-primary/10";
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg ${tone}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </Card>
  );
}
