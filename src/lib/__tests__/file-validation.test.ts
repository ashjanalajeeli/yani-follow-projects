import { describe, expect, it } from "vitest";
import {
  getSupportedFileType,
  safeStorageFileName,
  uploadErrorMessage,
  validateProjectFile,
  validateReceiptFile,
} from "../file-validation";
import { clip, LIMITS } from "../input-limits";

describe("file validation", () => {
  it("allows only PDF, DOCX, TXT and MD", () => {
    expect(getSupportedFileType("brief.PDF")).toBe("application/pdf");
    expect(getSupportedFileType("notes.md")).toBe("text/markdown");
    for (const name of ["x.html", "x.svg", "x.exe", "x.pdf.exe", "noext"]) {
      expect(getSupportedFileType(name)).toBeUndefined();
    }
  });

  it("strips path traversal and unsafe characters from storage names", () => {
    expect(safeStorageFileName("../../etc/passwd")).toBe("passwd");
    expect(safeStorageFileName("..\\..\\win.ini")).toBe("win.ini");
    expect(safeStorageFileName("ملف مهم.pdf")).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(safeStorageFileName("a".repeat(500) + ".pdf").length).toBeLessThanOrEqual(120);
  });

  it("rejects empty and oversized project files", () => {
    expect(validateProjectFile({ name: "a.pdf", size: 0 })).toBeDefined();
    expect(validateProjectFile({ name: "a.pdf", size: 26 * 1024 * 1024 })).toBeDefined();
    expect(validateProjectFile({ name: "a.pdf", size: 1000 })).toBeUndefined();
  });

  it("accepts only image/PDF receipts with a matching MIME type", () => {
    expect(validateReceiptFile({ name: "r.png", size: 1000, type: "image/png" })).toBeUndefined();
    expect(validateReceiptFile({ name: "r.png", size: 1000, type: "text/html" })).toBeDefined();
    expect(validateReceiptFile({ name: "r.svg", size: 1000, type: "image/svg+xml" })).toBeDefined();
  });
});

describe("input limits", () => {
  it("clips strings and ignores non-strings", () => {
    expect(clip("x".repeat(50_000), LIMITS.ideaText)).toHaveLength(LIMITS.ideaText);
    expect(clip(undefined, 10)).toBe("");
    expect(clip({ toString: () => "evil" }, 10)).toBe("");
  });
});

describe("upload error messages", () => {
  it("never shows raw storage/RLS errors to users", () => {
    const rls = { message: 'new row violates row-level security policy for table "objects"' };
    expect(uploadErrorMessage(rls)).not.toMatch(/row-level|policy|objects/);
    expect(uploadErrorMessage({ message: "connect ECONNREFUSED 10.0.0.5:5432" })).not.toMatch(
      /ECONNREFUSED|10\.0\.0\.5/,
    );
    expect(uploadErrorMessage(null)).toBeTruthy();
  });
});
