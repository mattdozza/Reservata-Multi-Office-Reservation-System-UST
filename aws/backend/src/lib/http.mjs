export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export function requireFields(input, fields) {
  const missing = fields.filter((field) => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length) throw new HttpError(400, `Missing required fields: ${missing.join(", ")}`);
}

export function wrap(handler) {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      if (error?.name === "ConditionalCheckFailedException" || error?.name === "TransactionCanceledException") {
        return json(409, { error: "The record changed before this action completed. Refresh and try again." });
      }
      const statusCode = error.statusCode || 500;
      if (statusCode >= 500) console.error(error);
      return json(statusCode, { error: statusCode >= 500 ? "Internal server error." : error.message });
    }
  };
}

export function method(event) {
  return event.requestContext?.http?.method || event.httpMethod;
}
