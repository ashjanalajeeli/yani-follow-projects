import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_PROJECT_FILE_SIZE_BYTES, getSupportedFileType } from "./file-validation";
import { LIMITS } from "./input-limits";
import { parseDocument } from "./parse-document.server";

const inputSchema = z.object({
  projectId: z.string().uuid(),
  storagePath: z.string().min(1).max(1024),
  name: z.string().min(1).max(LIMITS.fileName),
  mime: z.string().max(255),
  size: z.number().int().positive().max(MAX_PROJECT_FILE_SIZE_BYTES),
});

// Path layout written by the client: <userId>/<projectId>/<timestamp>-<safe name>
const SAFE_LEAF = /^[A-Za-z0-9._-]{1,160}$/;

export const parseAndAttach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const expectedPathPrefix = `${userId}/${data.projectId}/`;
    const leaf = data.storagePath.slice(expectedPathPrefix.length);
    if (
      !data.storagePath.startsWith(expectedPathPrefix) ||
      !SAFE_LEAF.test(leaf) ||
      leaf.includes("..")
    ) {
      throw new Error("Invalid storage path");
    }
    const mime = getSupportedFileType(data.name);
    if (!mime || getSupportedFileType(leaf) !== mime) {
      throw new Error("Unsupported file type");
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .single();
    if (!project) throw new Error("Project not found");

    // Idempotent: the same object is parsed and attached at most once.
    const { data: existing } = await supabase
      .from("project_files")
      .select("id")
      .eq("storage_path", data.storagePath)
      .maybeSingle();
    if (existing) return { ok: true, chars: 0 };

    const { data: planLimit, error: limitError } = await supabase.rpc("my_file_size_limit");
    if (limitError || typeof planLimit !== "number") {
      console.error("[parseAndAttach] my_file_size_limit", limitError);
      throw new Error("تعذر التحقق من حدود خطتك.");
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from("project-files")
      .download(data.storagePath);
    if (downloadError || !file) {
      console.error("[parseAndAttach] download", downloadError);
      throw new Error("تعذر قراءة الملف المرفوع.");
    }
    // Enforce the plan limit on the real stored size (the upload-time RLS check
    // only sees the size the client declared).
    if (file.size === 0 || file.size > Math.min(planLimit, MAX_PROJECT_FILE_SIZE_BYTES)) {
      await supabase.storage.from("project-files").remove([data.storagePath]);
      throw new Error("حجم الملف غير صحيح أو يتجاوز الحد المسموح في خطتك.");
    }

    const buffer = await file.arrayBuffer();
    const text = await parseDocument(buffer, mime, data.name);

    const { error } = await supabase.from("project_files").insert({
      project_id: data.projectId,
      name: data.name,
      storage_path: data.storagePath,
      mime,
      size: file.size,
      parsed_text: text.slice(0, LIMITS.parsedText),
      kind: "brief",
    });
    if (error) {
      console.error("[parseAndAttach] insert", error);
      if (error.code === "23505") return { ok: true, chars: 0 }; // concurrent duplicate
      await supabase.storage.from("project-files").remove([data.storagePath]);
      throw new Error(
        error.message.includes("File limit reached")
          ? "وصلت إلى الحد الأقصى لعدد الملفات في هذا المشروع."
          : "تعذر حفظ الملف.",
      );
    }
    return { ok: true, chars: text.length };
  });
