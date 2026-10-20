import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Copy, ExternalLink, GraduationCap } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/$id/tasks/$taskId")({
  head: ({ params }) => ({
    meta: [
      { title: "Task details — Yani" },
      { name: "description", content: "Task detail with subtasks, free tool recommendations, AI prompts and learning resources." },
      { property: "og:title", content: "Task details — Yani" },
      { property: "og:description", content: "Task detail with subtasks, free tool recommendations, AI prompts and learning resources." },
      { property: "og:url", content: `https://freeflow-projects.lovable.app/projects/${params.id}/tasks/${params.taskId}` },
    ],
  }),
  component: TaskDetail,
});

interface Learning { what?: string; why?: string; how?: string }

function TaskDetail() {
  const { id, taskId } = Route.useParams();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const [task, subs, tools, prompts] = await Promise.all([
        supabase.from("tasks").select("*").eq("id", taskId).single(),
        supabase.from("subtasks").select("*").eq("task_id", taskId).order("order_index"),
        supabase.from("task_tools").select("*").eq("task_id", taskId),
        supabase.from("task_prompts").select("*").eq("task_id", taskId),
      ]);
      return {
        task: task.data,
        subtasks: subs.data ?? [],
        tools: tools.data ?? [],
        prompts: prompts.data ?? [],
      };
    },
  });

  const toggleSub = useMutation({
    mutationFn: async ({ subId, done }: { subId: string; done: boolean }) => {
      await supabase.from("subtasks").update({ done }).eq("id", subId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const toggleTask = useMutation({
    mutationFn: async (completed: boolean) => {
      await supabase.from("tasks").update({ completed, status: completed ? "done" : "todo" }).eq("id", taskId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["project-tasks", id] });
      qc.invalidateQueries({ queryKey: ["roadmap", id] });
    },
  });

  if (!data?.task) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { task, subtasks, tools, prompts } = data;
  const learning = (task.learning_notes as Learning | null) ?? {};
  const doneSubs = subtasks.filter((s) => s.done).length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6 md:p-8">
      <Link to="/projects/$id/roadmap" params={{ id }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Back to roadmap
      </Link>

      <Card className="p-6">
        <div className="mb-3 flex items-start gap-3">
          <Checkbox checked={task.completed} onCheckedChange={(v) => toggleTask.mutate(!!v)} className="mt-1" />
          <div className="flex-1">
            <h1 className={`text-2xl font-semibold ${task.completed ? "text-muted-foreground line-through" : ""}`}>
              {task.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="capitalize">{task.priority} priority</Badge>
              <Badge variant="outline" className="capitalize">{task.difficulty}</Badge>
              {task.estimated_hours && <Badge variant="secondary">{task.estimated_hours}h</Badge>}
            </div>
          </div>
        </div>
        {task.description && <p className="text-sm leading-relaxed">{task.description}</p>}
        {task.expected_output && (
          <div className="mt-4 rounded-md border border-border/70 bg-accent/30 p-3 text-sm">
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Expected output</div>
            {task.expected_output}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Subtasks</h2>
          <span className="text-xs text-muted-foreground">{doneSubs}/{subtasks.length}</span>
        </div>
        {subtasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subtasks.</p>
        ) : (
          <ul className="space-y-2">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <Checkbox checked={s.done} onCheckedChange={(v) => toggleSub.mutate({ subId: s.id, done: !!v })} />
                <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.title}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Tabs defaultValue="tools">
        <TabsList>
          <TabsTrigger value="tools">Free tools</TabsTrigger>
          <TabsTrigger value="prompts">AI prompts</TabsTrigger>
          <TabsTrigger value="learn">Learn</TabsTrigger>
        </TabsList>

        <TabsContent value="tools" className="mt-3">
          <Card className="p-5">
            {tools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tools attached.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {tools.map((t) => (
                  <a
                    key={t.id}
                    href={t.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-start gap-3 rounded-lg border border-border/60 p-3 transition hover:border-primary/50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        {t.tool_name}
                        <ExternalLink className="size-3 opacity-50 group-hover:opacity-100" />
                      </div>
                      <div className="text-xs text-muted-foreground">{t.why}</div>
                    </div>
                    <Badge variant="secondary" className="capitalize">{t.category}</Badge>
                  </a>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="prompts" className="mt-3">
          <div className="space-y-2">
            {prompts.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="secondary" className="capitalize">{p.target}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(p.prompt_text);
                      toast.success("Prompt copied");
                    }}
                  >
                    <Copy className="size-3.5" /> Copy
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-accent/40 p-3 font-mono text-xs">{p.prompt_text}</pre>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="learn" className="mt-3">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <GraduationCap className="size-4" /> Beginner explanation
            </div>
            {!learning.what && !learning.why && !learning.how ? (
              <p className="text-sm text-muted-foreground">No learning notes yet.</p>
            ) : (
              <dl className="space-y-3 text-sm">
                {learning.what && <div><dt className="text-xs font-medium uppercase text-muted-foreground">What am I doing?</dt><dd className="mt-0.5">{learning.what}</dd></div>}
                {learning.why && <div><dt className="text-xs font-medium uppercase text-muted-foreground">Why?</dt><dd className="mt-0.5">{learning.why}</dd></div>}
                {learning.how && <div><dt className="text-xs font-medium uppercase text-muted-foreground">How does it work?</dt><dd className="mt-0.5">{learning.how}</dd></div>}
              </dl>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
