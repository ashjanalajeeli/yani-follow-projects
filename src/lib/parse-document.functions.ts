import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseDocument } from "./parse-document.server";

export const parseAndAttach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    projectId: string;
    storagePath: string;
    name: string;
    mime: string;
    size: number;
  }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify ownership
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .single();
    if (!project) throw new Error("Project not found");

    const { data: dl, error: dlErr } = await supabase.storage.from("project-files").download(data.storagePath);
    if (dlErr || !dl) throw dlErr ?? new Error("Download failed");
    const buffer = await dl.arrayBuffer();
    const text = await parseDocument(buffer, data.mime, data.name);

    const { error } = await supabase.from("project_files").insert({
      project_id: data.projectId,
      name: data.name,
      storage_path: data.storagePath,
      mime: data.mime,
      size: data.size,
      parsed_text: text.slice(0, 200_000),
      kind: "brief",
    });
    if (error) throw error;
    return { ok: true, chars: text.length };
  });
