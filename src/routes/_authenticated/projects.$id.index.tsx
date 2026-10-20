import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock, DollarSign, Zap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id/")({
  head: ({ params }) => ({
    meta: [
      { title: "Project overview — Yani" },
      { name: "description", content: "AI analysis of your project: type, complexity, tech stack, architecture, risks, timeline and cost estimates." },
      { property: "og:title", content: "Project overview — Yani" },
      { property: "og:description", content: "AI analysis of your project: type, complexity, tech stack, architecture, risks, timeline and cost estimates." },
      { property: "og:url", content: `https://yani-follow-projects.lovable.app/projects/${params.id}` },
    ],
  }),
  component: Overview,
});

interface Analysis {
  project_type?: string;
  complexity?: string;
  tech_stack?: string[];
  suggested_architecture?: string;
  required_apis?: string[];
  database?: string;
  authentication?: string;
  admin_dashboard?: string;
  hosting?: string;
  risks?: string[];
  missing_requirements?: string[];
  estimated_hours?: number;
  estimated_cost_usd?: number;
  weeks_timeline?: number;
  summary?: string;
}

function Overview() {
  const { id } = Route.useParams();
  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => (await supabase.from("projects").select("*").eq("id", id).single()).data,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks", id],
    queryFn: async () => (await supabase.from("tasks").select("*").eq("project_id", id)).data ?? [],
  });

  const analysis = (project?.analysis as Analysis | null) ?? {};
  const done = tasks.filter((t) => t.completed).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      {analysis.summary && (
        <Card className="p-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Summary</h2>
          <p className="text-sm leading-relaxed">{analysis.summary}</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Clock} label="Estimated hours" value={analysis.estimated_hours ?? "—"} />
        <Stat icon={Zap} label="Timeline" value={analysis.weeks_timeline ? `${analysis.weeks_timeline}w` : "—"} />
        <Stat icon={DollarSign} label="Est. cost" value={analysis.estimated_cost_usd ? `$${analysis.estimated_cost_usd}` : "—"} />
        <Stat icon={CheckCircle2} label="Tasks done" value={`${done}/${tasks.length}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <InfoList title="Tech stack" items={analysis.tech_stack ?? []} />
        <InfoList title="Required APIs" items={analysis.required_apis ?? []} />
        <KV
          title="Suggested architecture"
          rows={[
            ["Architecture", analysis.suggested_architecture],
            ["Database", analysis.database],
            ["Authentication", analysis.authentication],
            ["Admin dashboard", analysis.admin_dashboard],
            ["Hosting", analysis.hosting],
          ]}
        />
        <Card className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risks & gaps</h3>
          </div>
          {(analysis.risks ?? []).length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Risks</div>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {analysis.risks?.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {(analysis.missing_requirements ?? []).length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Missing requirements</div>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {analysis.missing_requirements?.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {(analysis.risks ?? []).length === 0 && (analysis.missing_requirements ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No risks detected.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card className="p-6">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <span key={i} className="rounded-md border border-border/70 bg-accent/30 px-2 py-1 text-xs">{i}</span>
          ))}
        </div>
      )}
    </Card>
  );
}

function KV({ title, rows }: { title: string; rows: Array<[string, string | undefined]> }) {
  return (
    <Card className="p-6">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="space-y-2 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-2">
            <dt className="col-span-1 text-muted-foreground">{k}</dt>
            <dd className="col-span-2">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
