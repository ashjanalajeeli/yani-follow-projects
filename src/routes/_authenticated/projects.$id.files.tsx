import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  getSupportedFileType,
  MAX_FILES_PER_BATCH,
  validateProjectFile,
} from "@/lib/file-validation";

export const Route = createFileRoute("/_authenticated/projects/$id/files")({
  head: ({ params }) => ({
    meta: [
      { title: "Project files — Yani" },
      {
        name: "description",
        content: "Briefs, documents and attachments uploaded to your project for AI analysis.",
      },
      { property: "og:title", content: "Project files — Yani" },
      {
        property: "og:description",
        content: "Briefs, documents and attachments uploaded to your project for AI analysis.",
      },
      {
        property: "og:url",
        content: `https://yani-follow-projects.yani.app/projects/${params.id}/files`,
      },
    ],
  }),
  component: FilesPage,
});

function FilesPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data: files = [] } = useQuery({
    queryKey: ["project-files", id],
    queryFn: async () =>
      (
        await supabase
          .from("project_files")
          .select("*")
          .eq("project_id", id)
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const upload = useMutation({
    mutationFn: async (fileList: FileList) => {
      const incoming = Array.from(fileList);
      if (incoming.length > MAX_FILES_PER_BATCH)
        throw new Error(`يمكن رفع ${MAX_FILES_PER_BATCH} ملفات كحد أقصى لكل دفعة.`);
      const invalid = incoming.map((file) => validateProjectFile(file)).find(Boolean);
      if (invalid) throw new Error(invalid);
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not signed in");
      for (const f of incoming) {
        const path = `${user.user.id}/${id}/${Date.now()}-${f.name}`;
        const { error } = await supabase.storage.from("project-files").upload(path, f, {
          contentType: getSupportedFileType(f.name),
        });
        if (error) throw error;
        await supabase.from("project_files").insert({
          project_id: id,
          name: f.name,
          storage_path: path,
          mime: getSupportedFileType(f.name),
          size: f.size,
        });
      }
    },
    onSuccess: () => {
      toast.success("Uploaded");
      qc.invalidateQueries({ queryKey: ["project-files", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  const remove = useMutation({
    mutationFn: async (file: { id: string; storage_path: string }) => {
      await supabase.storage.from("project-files").remove([file.storage_path]);
      await supabase.from("project_files").delete().eq("id", file.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-files", id] }),
  });

  async function download(path: string, name: string) {
    const { data } = await supabase.storage.from("project-files").createSignedUrl(path, 60);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = name;
      a.click();
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6 md:p-8">
      <Card className="p-6">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-sm text-muted-foreground transition hover:border-primary/60 hover:bg-accent/30">
          <Upload className="size-6" />
          Click to upload files
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => e.target.files && upload.mutate(e.target.files)}
          />
        </label>
      </Card>

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <Card className="divide-y divide-border/60">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-3">
              <FileText className="size-4 text-muted-foreground" />
              <button
                className="flex-1 truncate text-left text-sm hover:underline"
                onClick={() => download(f.storage_path, f.name)}
              >
                {f.name}
              </button>
              <span className="text-xs text-muted-foreground">{f.mime}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove.mutate({ id: f.id, storage_path: f.storage_path })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
