# Database Schema

The local defense database is `data/db.json`. The AWS implementation provisions separate encrypted, on-demand DynamoDB tables with point-in-time recovery enabled for production.

## Users

Account and RBAC fields: `name`, `email`, `office`, `role`, and `status`. University SSO proves identity; this record supplies Reservata authorization.

## Offices

Configuration fields: `id`, `name`, and `status`. Super Admins maintain these records. Renames cascade to current users and resources in the administrative backend.

## Approval Workflows

Reusable routing fields:

- `id`, `name`, `resourceType`, and `status`
- `steps[]` with `id`, `name`, `office`, `sequence`, and `condition`
- `$OWNER` resolves to the selected resource's owning office
- supported conditions: `always`, `setupRequired`, `externalVisitors`, and `parkingRequired`

Sequence 1 is the owner review. Matching steps with the same later sequence become pending together and run in parallel.

## Resources

Fields: `id`, `name`, `type`, `office`, `location`, `capacity`, `status`, `requiresPayment`, `fee`, `driver`, and `workflowTemplateId`.

Statuses: `Available`, `Reserved`, `In Use`, `Under Maintenance`, `Unavailable`, and `Archived`.

## Reservations

Core fields: `id`, requester/resource identity fields, `office`, `type`, `date`, `start`, `end`, `quantity`, `purpose`, `submittedAt`, `requiresPayment`, optional `paymentId`, optional `supportingDocuments[]`, and `slotLockVersion` in AWS records created with reservation locks.

Routing fields:

- `workflowTemplateId` and `workflowName`
- request flags `setupRequired`, `externalVisitors`, and `parkingRequired`
- `approvalSteps[]`, a permanent route snapshot containing the assigned office, sequence, condition, decision status, decision actor, and decision time
- `workflowVersion` in DynamoDB for optimistic concurrency control

Reservation statuses: `Under Owner Review`, `Under Additional Review`, `For Payment`, `Confirmed`, and `Rejected`.

Approval-step statuses: `Waiting`, `Pending`, `Approved`, `Rejected`, and `Skipped`.

## Reservation Locks

Each pending or approved booking occupies one conditional item per 15-minute interval. Fields are `slotKey`, `reservationId`, and DynamoDB TTL value `expiresAt`. Lock creation and reservation submission use one transaction, so concurrent overlapping requests cannot both be created. Rejected requests and rejected payments release their lock records.

## Payments

Fields: `id`, `reservationId`, `requester`, `office`, `amount`, `receipt`, and `status`.

Statuses: `Awaiting Receipt`, `Pending Verification`, `Verified`, and `Rejected`. The record is created only after all operational approvals. Receipt objects are private S3 keys in AWS mode.

## Visitors

Fields: `id`, requester/visitor identity, organization, purpose, schedule, guest and vehicle counts, plate, parking, and status.

Statuses: `Pending`, `Approved`, `Rejected`, and `Arrived`.

## Notifications

Fields: `id`, `user`, `message`, and `unread`.

## Activity

Append-only audit fields: `action`, `actor`, `target`, and `time`.

## Local-Only Settings

`systemSettings` holds local demonstration configuration that does not require a separate production table yet. Operational settings that affect authorization or routing are represented by the Offices, Users, Resources, and Approval Workflows domain records.
