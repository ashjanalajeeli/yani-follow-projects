import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/$id/kanban")({
  head: ({ params }) => ({
    meta: [
      { title: "Project kanban board — Yani" },
      { name: "description", content: "Kanban board for your project: move tasks across todo, in progress, review and done." },
      { property: "og:title", content: "Project kanban board — Yani" },
      { property: "og:description", content: "Kanban board for your project: move tasks across todo, in progress, review and done." },
      { property: "og:url", content: `https://freeflow-projects.lovable.app/projects/${params.id}/kanban` },
    ],
  }),
  component: Kanban,
});

const COLUMNS = [
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Review" },
  { key: "testing", label: "Testing" },
  { key: "done", label: "Done" },
] as const;

function Kanban() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({
    queryKey: ["kanban", id],
    queryFn: async () => (await supabase.from("tasks").select("*").eq("project_id", id).order("order_index")).data ?? [],
  });

  const move = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const patch: { status: string; completed?: boolean } = { status };
      if (status === "done") patch.completed = true;
      const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kanban", id] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="mx-auto max-w-full overflow-x-auto p-6 md:p-8">
      <div className="grid min-w-[900px] gap-4 md:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => (t.status ?? "todo") === col.key);
          return (
            <div
              key={col.key}
              className="flex min-h-96 flex-col rounded-xl border border-border/60 bg-card/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const taskId = e.dataTransfer.getData("text/task-id");
                if (taskId) move.mutate({ taskId, status: col.key });
              }}
            >
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <span className="text-sm font-semibold">{col.label}</span>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {items.map((t) => (
                  <Link key={t.id} to="/projects/$id/tasks/$taskId" params={{ id, taskId: t.id }}>
                    <Card
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}
                      className="cursor-grab p-3 transition hover:border-primary/50 active:cursor-grabbing"
                    >
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="capitalize">{t.priority}</span>
                        {t.estimated_hours ? <span>{t.estimated_hours}h</span> : null}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Drag cards between columns to update status.</p>
    </div>
  );
}
