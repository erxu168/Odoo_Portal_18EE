/** Compress an image data URL to JPEG, capping dimensions at 1600px. Returns base64 string (no prefix). */
export default function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
        else { w = Math.round((w * MAX) / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("No canvas context")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const result = canvas.toDataURL("image/jpeg", 0.85);
      resolve(result.split(",")[1]);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
