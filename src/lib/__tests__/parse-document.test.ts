import { describe, expect, it } from "vitest";
import { inspectZip, parseDocument } from "../parse-document.server";
import { buildZip, minimalDocx, toArrayBuffer } from "./zip-fixture";

describe("inspectZip (DOCX zip-bomb guard)", () => {
  it("accepts a normal DOCX", () => {
    const result = inspectZip(new Uint8Array(minimalDocx("hello")));
    expect(result.entries).toBe(3);
    expect(result.uncompressed).toBeLessThan(10_000);
  });

  it("rejects an archive that expands past 40 MB", () => {
    const bomb = buildZip({ "word/document.xml": Buffer.alloc(60 * 1024 * 1024, 0x30) });
    expect(bomb.length).toBeLessThan(1024 * 1024); // small on disk...
    expect(() => inspectZip(new Uint8Array(bomb))).toThrow(/expands too large/); // ...huge inflated
  });

  it("rejects an archive with too many entries", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 2001; i++) files[`f${i}.xml`] = "x";
    expect(() => inspectZip(new Uint8Array(buildZip(files)))).toThrow(/too many entries/);
  });

  it("rejects data that is not a ZIP", () => {
    expect(() => inspectZip(new Uint8Array(Buffer.from("PK not really a zip")))).toThrow(
      /Invalid DOCX archive/,
    );
  });
});

describe("parseDocument", () => {
  it("extracts text from a valid DOCX", async () => {
    const text = await parseDocument(toArrayBuffer(minimalDocx("Hello Yani brief")), "", "a.docx");
    expect(text).toContain("Hello Yani brief");
  });

  it("refuses a valid DOCX that inflates to 45 MB of text", async () => {
    // A well-formed document: without the guard, mammoth would return all 45 MB.
    const bomb = minimalDocx("A".repeat(45 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(await parseDocument(toArrayBuffer(bomb), "", "bomb.docx")).toBe("");
  });

  it("rejects a .pdf whose bytes are not a PDF", async () => {
    const fake = toArrayBuffer(Buffer.from("<html><script>alert(1)</script></html>"));
    expect(await parseDocument(fake, "application/pdf", "evil.pdf")).toBe("");
  });

  it("rejects a .docx whose bytes are not a ZIP", async () => {
    expect(await parseDocument(toArrayBuffer(Buffer.from("plain text")), "", "x.docx")).toBe("");
  });

  it("decodes .txt and .md as UTF-8", async () => {
    const text = await parseDocument(toArrayBuffer(Buffer.from("مرحبا\n# title")), "", "a.md");
    expect(text).toBe("مرحبا\n# title");
  });

  it("refuses unsupported extensions", async () => {
    expect(await parseDocument(toArrayBuffer(Buffer.from("MZ")), "", "a.exe")).toBe("");
  });
});
