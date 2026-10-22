export const MAX_PROJECT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
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

export function validateProjectFile(file: Pick<File, "name" | "size">): string | undefined {
  if (!getSupportedFileType(file.name)) {
    return "الأنواع المسموحة: PDF وDOCX وTXT وMD.";
  }
  if (file.size <= 0) return "الملف فارغ.";
  if (file.size > MAX_PROJECT_FILE_SIZE_BYTES) return "يجب ألا يتجاوز حجم الملف 10 ميغابايت.";
  return undefined;
}
