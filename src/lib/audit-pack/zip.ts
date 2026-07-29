import JSZip from "jszip";
import type { AuditPackFile } from "./types";

export async function buildZipBlob(files: AuditPackFile[]): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.path, f.content);
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
