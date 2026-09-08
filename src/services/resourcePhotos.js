import { loadLocalResourcePhoto, uploadLocalResourcePhoto } from "./api.js";
import { awsApi, awsBackendConfigured } from "./awsApi.js";

export async function prepareResourcePhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP photo.");
  if (file.size > 5_000_000) throw new Error("Choose a photo smaller than 5 MB.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This photo could not be opened. Choose another image."); });
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.65, 0.45]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= 400_000) return data;
    }
    throw new Error("Photo is too detailed. Choose a smaller image.");
  } finally { bitmap.close(); }
}

export async function uploadResourcePhoto(data) {
  return awsBackendConfigured ? awsApi.uploadResourcePhoto(data) : uploadLocalResourcePhoto(data);
}

export async function loadResourcePhoto(key) {
  return awsBackendConfigured ? awsApi.resourcePhoto(key) : loadLocalResourcePhoto(key);
}
