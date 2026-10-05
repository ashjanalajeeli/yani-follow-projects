import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id/roadmap")({
  head: () => ({
    meta: [
      { title: "Project roadmap — Yani" },
      {
        name: "description",
        content:
          "AI-generated roadmap for your project: stages, tasks and subtasks with progress tracking.",
      },
    ],
  }),
  component: Roadmap,
});

function Roadmap() {
  const { id } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["roadmap", id],
    queryFn: async () => {
      const [{ data: stages }, { data: tasks }] = await Promise.all([
        supabase.from("stages").select("*").eq("project_id", id).order("order_index"),
        supabase.from("tasks").select("*").eq("project_id", id).order("order_index"),
      ]);
      return { stages: stages ?? [], tasks: tasks ?? [] };
    },
  });

  const stages = data?.stages ?? [];
  const tasks = data?.tasks ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 md:p-8">
      {stages.length === 0 && <p className="text-sm text-muted-foreground">Roadmap generating…</p>}
      {stages.map((s) => {
        const st = tasks.filter((t) => t.stage_id === s.id);
        const done = st.filter((t) => t.completed).length;
        const pct = st.length ? Math.round((done / st.length) * 100) : 0;
        return (
          <Card key={s.id} className="overflow-hidden">
            <div className="border-b border-border/60 bg-card/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Stage {s.order_index + 1}</span>
                    <Badge variant="outline" className="capitalize">{s.status}</Badge>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">{s.name}</h3>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                </div>
                <div className="min-w-52">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{done}/{st.length} tasks</span><span>{pct}%</span>
                  </div>
                  <Progress value={pct} />
                </div>
              </div>
            </div>
            <div className="divide-y divide-border/60">
              {st.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No tasks yet.</div>
              ) : st.map((t) => (
                <Link
                  key={t.id}
                  to="/projects/$id/tasks/$taskId"
                  params={{ id, taskId: t.id }}
                  className="flex items-center justify-between gap-3 p-4 transition hover:bg-accent/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={t.completed ? "line-through text-muted-foreground" : ""}>{t.title}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{t.priority}</Badge>
                    </div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{t.description}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {t.estimated_hours ? `${t.estimated_hours}h` : "—"}
                    <div className="capitalize">{t.difficulty}</div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
