// Server-only document parser. PDF via unpdf, DOCX via mammoth, TXT/MD as UTF-8.

// Hard caps so one upload cannot exhaust the worker's memory (Cloudflare Workers: 128 MB).
const MAX_PDF_PAGES = 300;
const MAX_DOCX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2000;

/**
 * Reads the ZIP central directory and sums the declared uncompressed sizes,
 * so a "zip bomb" DOCX is rejected before mammoth inflates it.
 */
export function inspectZip(bytes: Uint8Array): { entries: number; uncompressed: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End Of Central Directory record: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  const minEocd = Math.max(0, bytes.length - 0xffff - 22);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid DOCX archive");
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64 DOCX is not supported");
  if (entries > MAX_DOCX_ENTRIES) throw new Error("DOCX has too many entries");
  if (cdOffset + cdSize > bytes.length) throw new Error("Invalid DOCX archive");

  let uncompressed = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) {
      throw new Error("Invalid DOCX archive");
    }
    uncompressed += view.getUint32(p + 24, true);
    if (uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error("DOCX expands too large");
    p +=
      46 +
      view.getUint16(p + 28, true) +
      view.getUint16(p + 30, true) +
      view.getUint16(p + 32, true);
  }
  return { entries, uncompressed };
}

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
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`PDF has more than ${MAX_PDF_PAGES} pages`);
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? (text as string[]).join("\n") : String(text ?? "");
    }
    if (lower.endsWith(".docx")) {
      if (!signature.startsWith("PK")) throw new Error("Invalid DOCX signature");
      inspectZip(bytes);
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
