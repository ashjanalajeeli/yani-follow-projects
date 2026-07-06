// Server-only document parser. PDF via unpdf, DOCX via mammoth, everything else falls back to text.
export async function parseDocument(buffer: ArrayBuffer, mime: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  try {
    if (mime.includes("pdf") || lower.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? (text as string[]).join("\n") : String(text ?? "");
    }
    if (mime.includes("word") || lower.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      return value;
    }
    // Plain text-ish fallback
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  } catch (err) {
    console.error("[parseDocument]", err);
    return "";
  }
}
