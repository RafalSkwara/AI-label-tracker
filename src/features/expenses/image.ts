/** Photo → JPEG of at most `edge` px on the long side and under `maxBytes` (Storage limit 1 MB; the AI request carries it as base64) */
export async function shrinkPhoto(file: File, edge = 1600, maxBytes = 900_000): Promise<{ blob: Blob; dataUrl: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  let blob: Blob | null = null;
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
    blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= maxBytes) break;
  }
  if (!blob || blob.size > maxBytes) throw new Error("zdjęcie jest za duże");
  const dataUrl = await new Promise<string>((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => bad(r.error);
    r.readAsDataURL(blob!);
  });
  return { blob, dataUrl };
}
