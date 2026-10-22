export const MAX_PROJECT_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_RECEIPT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_BATCH = 10;

const SUPPORTED_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

export function getSupportedFileType(name: string): string | undefined {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension ? SUPPORTED_FILE_TYPES[extension] : undefined;
}

export function safeStorageFileName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? "file";
  const safe = leaf.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return safe || "file";
}

export function validateProjectFile(file: Pick<File, "name" | "size">): string | undefined {
  if (!getSupportedFileType(file.name)) {
    return "الأنواع المسموحة: PDF وDOCX وTXT وMD.";
  }
  if (file.size <= 0) return "الملف فارغ.";
  if (file.size > MAX_PROJECT_FILE_SIZE_BYTES) return "يجب ألا يتجاوز حجم الملف 25 ميغابايت.";
  return undefined;
}

export function validateReceiptFile(
  file: Pick<File, "name" | "size" | "type">,
): string | undefined {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowed = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
  if (!extension || !allowed.has(extension)) return "إيصال الدفع يجب أن يكون صورة أو ملف PDF.";
  if (file.size <= 0 || file.size > MAX_RECEIPT_FILE_SIZE_BYTES) {
    return "يجب ألا يتجاوز حجم الإيصال 10 ميغابايت.";
  }
  const validMime = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (file.type && !validMime.has(file.type)) return "نوع ملف الإيصال غير مدعوم.";
  return undefined;
}
