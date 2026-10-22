// Server-only document parser. PDF via unpdf, DOCX via mammoth, everything else falls back to text.
export async function parseDocument(
  buffer: ArrayBuffer,
  mime: string,
  name: string,
): Promise<string> {
  const lower = name.toLowerCase();
  const bytes = new Uint8Array(buffer);
  const signature = String.fromCharCode(...bytes.slice(0, 4));
  try {
    if (lower.endsWith(".pdf")) {
      if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-")
        throw new Error("Invalid PDF signature");
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? (text as string[]).join("\n") : String(text ?? "");
    }
    if (lower.endsWith(".docx")) {
      if (!signature.startsWith("PK")) throw new Error("Invalid DOCX signature");
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      return value;
    }
    if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    }
    throw new Error(`Unsupported document type: ${mime}`);
  } catch (err) {
    console.error("[parseDocument]", err);
    return "";
  }
}
