// src/lib/imageDownscale.js — browser-only JPEG downscale for operator photos.
//
// A raw phone photo as a base64 data URL is routinely 4-10 MB, which exceeds
// Vercel's 4.5 MB request-body limit on /api/capture-scan, /api/collection and
// /api/asset-media-append (the comic scan path already downscales to 1200px
// via App.jsx's makeThumbnail; the Generic path used to send the raw file).
// Always resolves: on any failure (no canvas, decode error) it returns the
// original data URL unchanged — never throws, never drops the photo.

export function downscaleImageDataUrl(dataUrl, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    try {
      if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(dataUrl);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
