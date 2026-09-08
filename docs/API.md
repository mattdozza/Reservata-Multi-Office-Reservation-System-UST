# API Reference

Resource photos are optional. The browser converts JPG/PNG/WebP inputs (up to 5 MB) to JPEGs at most 1000 pixels on the longest side and under 400,000 data-URL characters. The resource stores only `photoKey`. Local endpoints are `POST /api/resource-photos` with `{ data }` and `GET /api/resource-photos/{key}`; files live in the git-ignored `data/resource-photos/` directory, which must be backed up with the database. AWS stores photos privately under `resource-photos/` in the existing bucket and returns temporary preview URLs. Removing or replacing a photo detaches its key; it does not delete the old stored object.

AWS receipts use two phases: request `/receipt-upload`, PUT the file to the returned S3 URL, then POST `{ objectKey }` to `/receipt-complete`. Only completion advances the payment. Deploy the updated frontend and SAM template together.

## AWS API Gateway API

All AWS endpoints require `Authorization: Bearer <University JWT>`. API Gateway validates issuer and audience, then Lambda applies the Reservata role and office stored for the authenticated email.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/bootstrap` | Return the authenticated user and role-scoped application state |
| GET/POST | `/resources` | List or create office resources |
| POST | `/resource-photos` | Upload a processed JPEG as an Office Admin; returns an office-owned photo key |
| GET | `/resource-photos/{id}` | Get a temporary preview URL for a visible resource photo |
| GET | `/resources/{id}/availability` | Check selected-slot availability, daily slots, and alternatives |
| PATCH | `/resources/{id}` | Edit or archive an Office Admin resource |
| PATCH | `/resources/{id}/status` | Update an Office Admin resource status |
| GET/POST | `/reservations` | List scoped reservations or submit a request |
| PATCH | `/reservations/{id}/decision` | Decide one assigned approval step and advance its route |
| POST | `/reservations/{id}/document-upload` | Create a five-minute private S3 upload URL for supporting documents |
| GET | `/payments` | List scoped payment records |
| POST | `/payments/{id}/receipt-upload` | Create a five-minute private S3 upload URL |
| POST | `/payments/{id}/receipt-complete` | Verify the uploaded S3 object and advance the payment to Pending Verification |
| PATCH | `/payments/{id}/verification` | Verify or reject a receipt |
| GET/POST | `/visitors` | List or submit visitor requests |
| PATCH | `/visitors/{id}/decision` | Approve or reject a visitor request |
| PATCH | `/visitors/{id}/check-in` | Record arrival |
| PATCH | `/visitors/{id}/parking` | Assign an available parking bay |
| GET/POST | `/users` | List users or provision a UST SSO account as Super Admin |
| PATCH | `/users/{email}/role` | Update a Reservata role as Super Admin |
| PATCH | `/users/{email}/access` | Activate or deactivate an account as Super Admin |
| GET/POST | `/offices` | List or create offices as Super Admin |
| PATCH | `/offices/{id}` | Rename, activate, or archive an office as Super Admin |
| GET/POST | `/workflows` | List or create approval workflows as Super Admin |
| PATCH | `/workflows/{id}` | Edit or archive an approval workflow as Super Admin |
| GET/PATCH | `/settings` | Read or update system settings as Super Admin |
| GET | `/notifications` | List the authenticated user's notifications |
| PATCH | `/notifications/read` | Mark the authenticated user's notifications read |
| GET | `/activity` | List the audit trail within role scope |

The Lambda handlers are in `aws/backend/src/handlers`. The API uses domain commands instead of saving the whole database state.

## Local Development API

The local API remains intentionally small so the defense demonstration runs without AWS credentials.

## GET `/api/health`

Checks if the local backend is running.

Response:

```json
{
  "ok": true,
  "service": "Reservata local API"
}
```

All local data routes require `Authorization: Bearer <local session token>`.

## POST `/api/auth/login`

Validates an active local defense account and returns its public user record, assigned role, office, and an expiring session token.

## GET `/api/auth/session`

Restores the authenticated account for a valid session token.

## GET `/api/resources/{id}/availability`

Returns availability for a selected resource, date, and time range using the full local database while keeping other requesters' reservation details private. The response includes the selected slot status, unavailable conflicts with only schedule/status metadata, available and unavailable slots for the selected date, and suggested alternative slots. Expired reservations are excluded from conflict checks.

Reservation lifecycle actions in AWS mode:

| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/reservations/{id}/cancel` | Requester cancellation for an active upcoming reservation |
| PATCH | `/reservations/{id}/reschedule` | Requester schedule change that sends the request back to owner review |
| PATCH | `/reservations/{id}/status` | Owning Office Admin/Super Admin lifecycle update for `In Use`, `Completed`, `No Show`, `Cancelled`, or `Expired` |

## POST `/api/auth/logout`

Invalidates the local session token.

## GET `/api/state`

Returns a role-scoped view of the local database. Hidden records are never sent to non-Super-Admin accounts.

Includes:

- `resources`
- `reservations`
- `payments`
- `visitors`
- `people`
- `offices`
- `approvalTemplates`
- `systemSettings`
- `notifications`
- `activity`

## PUT `/api/state`

Persists the current app data to `data/db.json` after server-side role, ownership, and office-scope validation.

Used after changes such as:

- reservation submission
- approval-step decisions and route advancement
- payment verification
- visitor request submission
- parking allocation
- arrival check-in
- account role/access updates
- office, resource, and approval-workflow maintenance
- payment deadline and additional-requirement settings

## POST `/api/reset`

Restores the database using `data/db.default.json`. Restricted to the Super Admin account.

## Local-to-AWS Mapping

| Local API | AWS Equivalent |
| --- | --- |
| `GET /api/state` | role-scoped `GET /bootstrap` and domain GET routes |
| `/api/auth/*` local sessions | University SSO JWT validation plus Users-table lookup |
| `PUT /api/state` | resource-specific Lambda commands |
| `POST /api/reset` | development/admin-only seed operation |
| `data/db.json` | encrypted DynamoDB tables |
| local receipt filename | private S3 object key and presigned PUT URL |
