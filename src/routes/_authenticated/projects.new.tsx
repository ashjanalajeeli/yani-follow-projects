import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Upload, Sparkles, X, FileText, Loader2 } from "lucide-react";
import { parseAndAttach } from "@/lib/parse-document.functions";
import { analyzeProject } from "@/lib/analyze-project.functions";

export const Route = createFileRoute("/_authenticated/projects/new")({
  head: () => ({
    meta: [
      { title: "New project — Yani" },
      { name: "description", content: "Describe an idea or upload a brief and get a full AI roadmap in minutes." },
      { property: "og:title", content: "New project — Yani" },
      { property: "og:description", content: "Describe an idea or upload a brief and get a full AI roadmap in minutes." },
      { property: "og:url", content: "https://yani-follow-projects.yani.app/projects/new" },
    ],
  }),
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [idea, setIdea] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const parseFn = useServerFn(parseAndAttach);
  const analyzeFn = useServerFn(analyzeProject);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Name is required");
    if (!idea.trim() && files.length === 0) return toast.error("Add an idea or upload a document");

    setBusy(true);
    try {
      setBusyLabel("Creating project…");
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not signed in");

      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          owner_id: user.user.id,
          name,
          description,
          idea_text: idea,
          generation_status: "pending",
        })
        .select()
        .single();
      if (error || !project) throw error ?? new Error("Create failed");

      // Upload + parse each file
      for (const [i, f] of files.entries()) {
        setBusyLabel(`Uploading ${i + 1}/${files.length}: ${f.name}`);
        const path = `${user.user.id}/${project.id}/${Date.now()}-${f.name}`;
        const { error: upErr } = await supabase.storage.from("project-files").upload(path, f);
        if (upErr) throw upErr;

        setBusyLabel(`Reading ${f.name}…`);
        await parseFn({
          data: {
            projectId: project.id,
            storagePath: path,
            name: f.name,
            mime: f.type || "application/octet-stream",
            size: f.size,
          },
        });
      }

      setBusyLabel("AI is analyzing your project (this can take 30–60s)…");
      await analyzeFn({ data: { projectId: project.id } });

      toast.success("Roadmap ready!");
      navigate({ to: "/projects/$id", params: { id: project.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
      setBusy(false);
      setBusyLabel("");
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold">New project</h1>
        <p className="text-sm text-muted-foreground">Give us an idea or upload a brief — AI does the rest.</p>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <Card className="space-y-4 p-6">
          <div>
            <Label htmlFor="name">Project name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme CRM redesign" required />
          </div>
          <div>
            <Label htmlFor="desc">Short description</Label>
            <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line for your list." />
          </div>
          <div>
            <Label htmlFor="idea">The idea / brief</Label>
            <Textarea
              id="idea"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={7}
              placeholder="Describe what you're building. Who is it for? Key features? Constraints? The more detail, the better the roadmap."
            />
          </div>
        </Card>

        <Card className="p-6">
          <Label className="mb-2 block">Documents (optional)</Label>
          <p className="mb-3 text-xs text-muted-foreground">
            PDF, DOCX, TXT, MD. We extract the text and feed it to the AI.
          </p>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-sm text-muted-foreground transition hover:border-primary/60 hover:bg-accent/30">
            <Upload className="size-6" />
            Click to upload or drag files here
            <input
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
              onChange={(e) => addFiles(e.target.files)}
            />
          </label>
          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md bg-accent/40 px-3 py-2 text-sm">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                  <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate({ to: "/projects" })} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} className="gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? busyLabel || "Working…" : "Generate roadmap"}
          </Button>
        </div>
      </form>
    </div>
  );
}
