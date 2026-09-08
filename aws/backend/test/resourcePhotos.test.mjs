import test from "node:test";
import assert from "node:assert/strict";
import { savePhoto, validatePhotoOwner, photoCommand } from "../src/lib/resourcePhotos.mjs";

test("resource photo uploads use encrypted office-owned S3 keys", async () => {
  let command;
  const user = { office: "Simbahayan" };
  const { key } = await savePhoto({ send: async (value) => { command = value; } }, user, "data:image/jpeg;base64,/9j/2Q==");
  assert.equal(validatePhotoOwner(key, user), key);
  assert.equal(command.input.Key, `resource-photos/${key}`);
  assert.equal(command.input.ContentType, "image/jpeg");
  assert.equal(command.input.ServerSideEncryption, "AES256");
  assert.equal(photoCommand(key).input.Key, command.input.Key);
  assert.throws(() => validatePhotoOwner(key, { office: "EdTech" }), /belonging to your office/);
  assert.throws(() => validatePhotoOwner("../file.jpg", user), /belonging to your office/);
  assert.equal(validatePhotoOwner("", user), "");
});

test("resource photo uploads reject unsupported and oversized data before S3 writes", async () => {
  const s3 = { send: async () => assert.fail("Invalid photo must not reach S3") };
  for (const data of [null, "data:image/svg+xml;base64,PHN2Zz4=", "data:image/jpeg;base64,YmFk", "x".repeat(400001)]) {
    await assert.rejects(savePhoto(s3, { office: "EdTech" }, data));
  }
});
