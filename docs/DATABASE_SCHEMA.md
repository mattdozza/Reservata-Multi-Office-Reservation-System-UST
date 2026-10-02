# Database Schema

The local defense database is `data/db.json`. The AWS implementation provisions separate encrypted, on-demand DynamoDB tables with point-in-time recovery enabled for production.

## Users

Account and RBAC fields: `name`, `email`, `office`, `role`, and `status`. University SSO proves identity; this record supplies Reservata authorization.

## Offices

Configuration fields: `id`, `name`, and `status`. Super Admins maintain these records. Renames cascade to current users and resources in the administrative backend.

## Approval Workflows

Reusable routing fields:

- `id`, `name`, `resourceType`, `status`, and an optional `office` that marks a workflow authored by a single office
- `steps[]` with `id`, `name`, `office`, and `sequence`
- `$OWNER` resolves to the selected resource's owning office

Sequence 1 is the owner review. Matching steps with the same later sequence become pending together and run in parallel. A step may also carry an optional `approvingBodyId` that links it to a seeded approving body. The Super Admin editor presents this value as the step's **approval tier** (`Tier 1` is the owner review, followed by `Tier 2`, `Tier 3`, ...), so admins pick a tier rather than a raw number.

The sample database ships two active templates: `WF-BASIC` (a single owner review for every resource type) and `WF-EVENT` (an owner review followed by parallel sequence-two Facilities setup, OSG event, and OSG parking steps for `Vehicle` resources). The Community Outreach Van and Dominican Shuttle are assigned to `WF-EVENT`, so every request for those vehicles runs the full owner, Facilities, and OSG route.

## Resources

Fields: `id`, unique `assetTag`, `name`, `type`, `office`, `location`, optional `serialNumber`, `tags[]`, `capacity`, `status`, `requiresPayment`, `fee`, optional `paymentDeadlineHours`, `driver`, and `workflowTemplateId`.

`assetTag` is the office inventory identifier for the physical or reservable asset. New resources receive an automatically generated editable tag using the owning office, resource type, and next sequence number. `tags[]` stores searchable labels such as `AV`, `Portable`, or `Paid`.

Statuses: `Available`, `Reserved`, `In Use`, `Under Maintenance`, `Unavailable`, and `Archived`.

## Reservations

Core fields: `id`, requester/resource identity fields, optional `resourceAssetTag`, `office`, `type`, `date`, `start`, `end`, `quantity`, `purpose`, `submittedAt`, `requiresPayment`, optional `paymentId`, optional `supportingDocuments[]`, and `slotLockVersion` in AWS records created with reservation locks.

Routing fields:

- `workflowTemplateId` and `workflowName`
- `approvalSteps[]`, a permanent route snapshot containing the assigned office, sequence, decision status, decision actor, and decision time
- `workflowVersion` in DynamoDB for optimistic concurrency control

Reservation statuses: `Under Owner Review`, `Under Additional Review`, `For Payment`, `Confirmed`, `In Use`, `Completed`, `Rejected`, `Cancelled`, `Expired`, and `No Show`.

Approval-step statuses: `Waiting`, `Pending`, `Approved`, `Rejected`, and `Skipped`.

## Reservation Locks

Each pending, approved, confirmed, payment-stage, or in-use booking occupies one conditional item per 15-minute interval. Fields are `slotKey`, `reservationId`, and DynamoDB TTL value `expiresAt`. Lock creation and reservation submission use one transaction, so concurrent overlapping requests cannot both be created. Rejected, cancelled, completed, expired, no-show, and rejected-payment requests release their lock records.

## Payments

Fields: `id`, `reservationId`, `requester`, `office`, `amount`, `receipt`, `status`, optional `paymentDeadlineHours`, and optional `paymentDeadlineAt`.

Statuses: `Awaiting Receipt`, `Pending Verification`, `Verified`, `Rejected`, `Cancelled`, and `Expired`. The record is created only after all operational approvals. Receipt objects are private S3 keys in AWS mode. Payment handoffs snapshot the effective payment window from the resource override or system default; missed deadlines expire the reservation before final confirmation.

## Visitors

Fields: `id`, requester/visitor identity, organization, purpose, schedule, guest and vehicle counts, plate, parking, and status.

Statuses: `Pending`, `Approved`, `Rejected`, and `Arrived`.

## Notifications

Fields: `id`, `user`, `message`, and `unread`.

## Activity

Append-only audit fields: `action`, `actor`, `target`, and `time`.

## System Settings

`systemSettings` stores cross-office configuration in local data and in the AWS `SystemSettingsTable`. The current fields are `id`, `defaultWorkflowTemplateId`, `maxReservationHours`, `parkingCapacity`, `paymentDeadlineHours`, and `paymentInstructions`. `paymentDeadlineHours` defaults to 24 and must be a whole number from 1 to 168. `paymentInstructions` is the admin-authored guidance shown to requesters on paid-request payment steps, trimmed and capped at 1200 characters (a default is used when unset).
