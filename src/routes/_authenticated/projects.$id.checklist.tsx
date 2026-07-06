import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/projects/$id/checklist")({
  component: ChecklistPage,
});

function ChecklistPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["checklist", id],
    queryFn: async () => {
      const { data: stages } = await supabase.from("stages").select("*").eq("project_id", id).order("order_index");
      const { data: items } = await supabase
        .from("checklists")
        .select("*")
        .in("stage_id", (stages ?? []).map((s) => s.id));
      return { stages: stages ?? [], items: items ?? [] };
    },
  });

  const toggle = useMutation({
    mutationFn: async (row: { id: string; done: boolean }) => {
      await supabase.from("checklists").update({ done: row.done }).eq("id", row.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklist", id] }),
  });

  const stages = data?.stages ?? [];
  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6 md:p-8">
      {stages.map((s) => {
        const rows = items.filter((i) => i.stage_id === s.id);
        if (!rows.length) return null;
        return (
          <Card key={s.id} className="p-5">
            <h3 className="mb-3 font-semibold">{s.name}</h3>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                  <Checkbox checked={r.done} onCheckedChange={(v) => toggle.mutate({ id: r.id, done: !!v })} />
                  <span className={r.done ? "text-muted-foreground line-through" : ""}>{r.item}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {items.length === 0 && <p className="text-sm text-muted-foreground">Checklists appear once the roadmap is generated.</p>}
    </div>
  );
}
