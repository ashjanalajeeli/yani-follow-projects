import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_PROJECT_FILE_SIZE_BYTES, getSupportedFileType } from "./file-validation";
import { parseDocument } from "./parse-document.server";

const inputSchema = z.object({
  projectId: z.string().uuid(),
  storagePath: z.string().min(1).max(1024),
  name: z.string().min(1).max(255),
  mime: z.string().max(255),
  size: z.number().int().positive().max(MAX_PROJECT_FILE_SIZE_BYTES),
});

export const parseAndAttach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const expectedPathPrefix = `${userId}/${data.projectId}/`;
    if (!data.storagePath.startsWith(expectedPathPrefix)) {
      throw new Error("Invalid storage path");
    }
    if (!getSupportedFileType(data.name)) {
      throw new Error("Unsupported file type");
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .single();
    if (!project) throw new Error("Project not found");

    const { data: file, error: downloadError } = await supabase.storage
      .from("project-files")
      .download(data.storagePath);
    if (downloadError || !file) throw downloadError ?? new Error("Download failed");
    if (file.size === 0 || file.size > MAX_PROJECT_FILE_SIZE_BYTES || file.size !== data.size) {
      throw new Error("File size is invalid or exceeds the 10 MB limit");
    }

    const buffer = await file.arrayBuffer();
    const text = await parseDocument(buffer, data.mime, data.name);

    const { error } = await supabase.from("project_files").insert({
      project_id: data.projectId,
      name: data.name,
      storage_path: data.storagePath,
      mime: getSupportedFileType(data.name)!,
      size: file.size,
      parsed_text: text.slice(0, 200_000),
      kind: "brief",
    });
    if (error) throw error;
    return { ok: true, chars: text.length };
  });
