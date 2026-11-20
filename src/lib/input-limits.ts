// Mirrors the CHECK constraints in supabase/migrations/20261120090000_security_hardening.sql.
export const LIMITS = {
  projectName: 200,
  projectDescription: 2000,
  ideaText: 20000,
  taskTitle: 500,
  taskDescription: 10000,
  expectedOutput: 5000,
  subtaskTitle: 500,
  checklistItem: 1000,
  fileName: 255,
  parsedText: 200_000,
} as const;

// Max characters of document text sent to the AI per file, and in total.
export const AI_DOC_CHARS_PER_FILE = 4000;
export const AI_DOC_FILES = 6;

export function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
