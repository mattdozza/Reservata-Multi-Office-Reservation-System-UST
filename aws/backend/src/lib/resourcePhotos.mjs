import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { HttpError } from "./http.mjs";

export const photoPrefix = (office) => createHash("sha256").update(office).digest("hex").slice(0, 16);
export const validPhotoKey = (key) => /^[a-f0-9]{16}-[a-f0-9-]{36}\.jpg$/.test(key);

export async function savePhoto(s3, user, data) {
  if (typeof data !== "string" || data.length > 400_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, "Choose a valid resource photo smaller than 300 KB after processing.");
  const bytes = Buffer.from(data.split(",")[1], "base64");
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new HttpError(400, "Invalid JPEG photo.");
  const key = `${photoPrefix(user.office)}-${randomUUID()}.jpg`;
  await s3.send(new PutObjectCommand({ Bucket: process.env.RECEIPTS_BUCKET, Key: `resource-photos/${key}`, Body: bytes, ContentType: "image/jpeg", ServerSideEncryption: "AES256" }));
  return { key };
}

export function photoCommand(key) {
  return new GetObjectCommand({ Bucket: process.env.RECEIPTS_BUCKET, Key: `resource-photos/${key}` });
}

export function validatePhotoOwner(key, user) {
  if (key && (!validPhotoKey(key) || !key.startsWith(`${photoPrefix(user.office)}-`))) throw new HttpError(400, "Upload a photo belonging to your office first.");
  return key || "";
}
