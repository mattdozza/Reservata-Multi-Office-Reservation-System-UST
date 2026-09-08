import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authenticatedUser, requireOffice, requireRole, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, newestFirst, notificationRecord, now } from "../lib/records.mjs";
import { expireReservations } from "../lib/reservationLifecycle.mjs";
import { reservationSlots } from "../lib/slots.mjs";
import { TABLES } from "../lib/tables.mjs";

const ALLOWED_RECEIPTS = new Set(["image/jpeg", "image/png", "application/pdf"]);

function safeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
}

async function listPayments(repo, user) {
  if (user.role === ROLES.requester) return repo.query(TABLES.payments, "requester-index", "requesterEmail", user.email);
  if (user.role === ROLES.officeAdmin) return repo.query(TABLES.payments, "office-index", "office", user.office);
  if (user.role === ROLES.superAdmin) return repo.scan(TABLES.payments);
  throw new HttpError(403, "Your role cannot access payments.");
}

export function createHandler(repo = repository, s3 = new S3Client({}), signer = getSignedUrl) {
  return wrap(async (event) => {
    const user = await authenticatedUser(event, repo);
    const requestMethod = method(event);

    if (requestMethod === "GET") {
      return json(200, { items: newestFirst(await listPayments(repo, user)) });
    }

    const payment = await repo.get(TABLES.payments, { id: event.pathParameters?.id });
    if (!payment) throw new HttpError(404, "Payment record not found.");

    if (requestMethod === "POST") {
      requireRole(user, ROLES.requester);
      if (payment.requesterEmail !== user.email) throw new HttpError(403, "This payment does not belong to your account.");
      const reservation = await repo.get(TABLES.reservations, { id: payment.reservationId });
      if (!reservation) throw new HttpError(404, "Related reservation not found.");
      await expireReservations(repo, [reservation], [payment]);
      if (reservation.status === "Expired" || payment.status === "Expired") throw new HttpError(409, "This reservation expired before final confirmation.");
      if (reservation.status !== "For Payment" || payment.status !== "Awaiting Receipt") throw new HttpError(409, "This reservation is no longer awaiting a receipt.");
      const body = parseBody(event);
      if (event.rawPath?.endsWith("/receipt-complete")) {
        if (!body.objectKey || body.objectKey !== payment.receiptUploadKey) throw new HttpError(409, "Start a new receipt upload before confirming it.");
        let uploaded;
        try { uploaded = await s3.send(new HeadObjectCommand({ Bucket: process.env.RECEIPTS_BUCKET, Key: body.objectKey })); }
        catch { throw new HttpError(409, "The receipt has not finished uploading. Please try again."); }
        if (!uploaded.ContentLength || uploaded.ContentLength > 5 * 1024 * 1024 || !ALLOWED_RECEIPTS.has(uploaded.ContentType)) throw new HttpError(400, "Receipt must be a JPG, PNG, or PDF up to 5 MB.");
        const uploadedAt = now();
        const activity = activityRecord(user, "Receipt uploaded", reservation.id, reservation.office, reservation.id, payment.receiptUploadName);
        const notification = notificationRecord(reservation.office, reservation.office, `${reservation.resourceName}: ${reservation.requester} uploaded a receipt for verification.`);
        await repo.transact([
          { ConditionCheck: {
            TableName: TABLES.reservations, Key: { id: reservation.id },
            ConditionExpression: "#status = :forPayment",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":forPayment": "For Payment" }
          } },
          { Update: {
            TableName: TABLES.payments, Key: { id: payment.id },
            UpdateExpression: "SET receipt = :receipt, receiptKey = :key, #status = :next, uploadedAt = :at, updatedAt = :at",
            ConditionExpression: "#status = :awaiting AND receiptUploadKey = :key",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":receipt": payment.receiptUploadName, ":key": body.objectKey, ":next": "Pending Verification", ":awaiting": "Awaiting Receipt", ":at": uploadedAt }
          } },
          { Put: { TableName: TABLES.activity, Item: activity } },
          { Put: { TableName: TABLES.notifications, Item: notification } }
        ]);
        return json(200, { objectKey: body.objectKey, status: "Pending Verification" });
      }
      requireFields(body, ["filename", "contentType"]);
      if (!ALLOWED_RECEIPTS.has(body.contentType)) throw new HttpError(400, "Receipt must be a JPG, PNG, or PDF file.");
      const objectKey = `receipts/${encodeURIComponent(user.email)}/${payment.id}/${randomUUID()}-${safeFilename(body.filename)}`;
      const command = new PutObjectCommand({
        Bucket: process.env.RECEIPTS_BUCKET,
        Key: objectKey,
        ContentType: body.contentType,
        ServerSideEncryption: "AES256"
      });
      const uploadUrl = await signer(s3, command, { expiresIn: 300 });
      await repo.update(TABLES.payments, { id: payment.id }, { receiptUploadKey: objectKey, receiptUploadName: safeFilename(body.filename), updatedAt: now() }, {
        ConditionExpression: "requesterEmail = :requesterEmail AND #status = :awaiting",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":requesterEmail": user.email, ":awaiting": "Awaiting Receipt" }
      });
      return json(200, { uploadUrl, objectKey, expiresIn: 300 });
    }

    if (requestMethod === "PATCH") {
      requireRole(user, ROLES.officeAdmin);
      requireOffice(user, payment);
      const body = parseBody(event);
      if (typeof body.verified !== "boolean") throw new HttpError(400, "verified must be true or false.");
      if (body.verified && payment.receipt === "Awaiting upload") throw new HttpError(409, "A receipt must be uploaded before verification.");
      const reservation = await repo.get(TABLES.reservations, { id: payment.reservationId });
      if (!reservation) throw new HttpError(404, "Related reservation not found.");
      await expireReservations(repo, [reservation], [payment]);
      if (reservation.status === "Expired" || payment.status === "Expired") throw new HttpError(409, "This reservation expired before final confirmation.");
      requireOffice(user, reservation);
      const paymentStatus = body.verified ? "Verified" : "Rejected";
      const reservationStatus = body.verified ? "Confirmed" : "Rejected";
      const updatedAt = now();
      const activity = activityRecord(user, body.verified ? "Payment verified" : "Payment rejected", reservation.id, reservation.office, reservation.id, body.reason || "");
      const notification = notificationRecord(
        reservation.requesterEmail,
        reservation.requester,
        body.verified ? `${reservation.resourceName} payment was verified. The reservation is confirmed.` : `${reservation.resourceName} payment was rejected.`
      );
      const transaction = [
        { Update: {
          TableName: TABLES.payments,
          Key: { id: payment.id },
          UpdateExpression: "SET #status = :next, updatedAt = :updatedAt",
          ConditionExpression: "#status = :pending AND office = :office",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":next": paymentStatus, ":updatedAt": updatedAt, ":pending": "Pending Verification", ":office": user.office }
        } },
        { Update: {
          TableName: TABLES.reservations,
          Key: { id: reservation.id },
          UpdateExpression: "SET #status = :next, updatedAt = :updatedAt",
          ConditionExpression: "#status = :forPayment",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":next": reservationStatus, ":updatedAt": updatedAt, ":forPayment": "For Payment" }
        } },
        { Put: { TableName: TABLES.activity, Item: activity } },
        { Put: { TableName: TABLES.notifications, Item: notification } }
      ];
      if (!body.verified) {
        transaction.push(...reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end).map((slotKey) => ({
          Delete: { TableName: TABLES.reservationLocks, Key: { slotKey } }
        })));
      }
      await repo.transact(transaction);
      return json(200, { payment: { ...payment, status: paymentStatus }, reservation: { ...reservation, status: reservationStatus } });
    }

    throw new HttpError(405, "Method not allowed.");
  });
}

export const handler = createHandler();
