// Shared photo-upload util used by both /tasks/staff and /tasks/manager/dept/[id].
// Phone photos are 3-10 MB raw; we resize to a 1280-px long edge and re-encode
// JPEG at 0.85 client-side, which typically yields 100-300 KB and avoids the
// body-size and timeout failures we saw with raw uploads.

async function compressImage(file: File, maxLongEdge: number, quality: number): Promise<{ base64: string; filename: string }> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result as string);
    reader.onerror = () => rej(new Error('File read error'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Image decode error'));
    i.src = dataUrl;
  });
  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = compressedDataUrl.split(',')[1] || '';
  const stem = file.name.replace(/\.[^/.]+$/, '') || 'photo';
  return { base64, filename: `${stem}.jpg` };
}

export function uploadTaskPhoto(lineId: number, onAfter?: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment' as never;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file selected'));
      try {
        const compressed = await compressImage(file, 1280, 0.85);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const res = await fetch(`/api/tasks/lines/${lineId}/photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: compressed.filename, data_base64: compressed.base64 }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        const body = await res.json();
        if (!body.ok) return reject(new Error(body.error || 'Upload failed'));
        if (onAfter) await onAfter();
        resolve();
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') {
          reject(new Error('Upload timed out — try again on a stronger connection'));
        } else {
          reject(e instanceof Error ? e : new Error('Upload failed'));
        }
      }
    };
    input.click();
  });
}
