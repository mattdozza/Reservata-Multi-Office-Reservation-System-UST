# System Flows

## Reservation And Multi-Tier Approval

1. A user signs in with an account assigned the Requester role.
2. The requester selects an available resource and date. Reservata displays the selected day's available and unavailable time slots.
3. The requester selects a schedule, quantity, purpose, and any additional requirements.
4. Reservata checks the time range, capacity inputs, and overlapping blocking reservations. Pending, approved, confirmed, and payment-stage reservations all block conflicting schedules.
5. If the selected slot is blocked, Reservata prevents submission and suggests alternative slots from the selected date or the next available dates.
6. In AWS mode, reservation submission writes 15-minute DynamoDB lock records in the same transaction as the pending request, so concurrent overlapping submissions cannot both succeed.
7. The selected resource supplies an active approval-workflow template.
8. Reservata snapshots the matching steps onto the reservation. Conditional steps are included only when the requester selects the related requirement.
9. The resource-owning office receives the sequence 1 owner review. The request has `Under Owner Review` status.
10. Owner approval activates the next sequence. Steps with the same sequence run in parallel, so separate support offices do not wait on one another unnecessarily.
11. Each office sees and decides only its pending assigned steps. A rejection stops the route, marks later waiting steps `Skipped`, and releases the reservation's held slot.
12. When all operational steps are approved, a free reservation becomes `Confirmed`; a fee-required reservation becomes `For Payment`.
13. The requester uploads a receipt. The resource-owning Office Admin verifies it and the request becomes `Confirmed`.

Example venue route:

```txt
Requester submission
  -> Simbahayan venue-owner review (sequence 1)
  -> Facilities setup review + OSG guest review + OSG parking review (sequence 2, parallel)
  -> Payment receipt and Simbahayan verification
  -> Confirmed reservation
```

## Administrative Maintenance

### Office Admin

1. Opens Office Settings.
2. Adds or edits resources owned by the assigned office.
3. Maintains resource type, location, capacity, availability, fee, and approval-workflow assignment.
4. Archives records instead of physically deleting them, preserving reservation and audit references.
5. May restore an archived resource by editing its status.

### Super Admin

1. Adds, renames, activates, or archives offices.
2. Assigns supported roles to existing user accounts and activates or deactivates access.
3. Creates approval workflows with an owner step plus supporting-office steps.
4. Configures step sequence and conditions. Equal sequence values run in parallel.
5. Edits or archives unused workflow templates. Existing reservations retain their snapshotted route.
6. Reviews system-wide coverage and audit activity.

## OSG Visitor Flow

1. OSG Requester submits a visitor access request.
2. OSG Admin approves or declines it.
3. Approved visitors may receive a parking bay.
4. OSG Admin records arrival and the status becomes `Arrived`.

OSG visitor processing is separate from reservation Event Reviews. Event Reviews appear only when a reservation workflow assigns an active guest, security, or parking step to OSG.

## RBAC Rules

- Users sign in with their own account and cannot select or self-assign a role.
- Requesters access only their reservations, payments, and notifications plus active reservable resources and workflows.
- Office Admins maintain only resources owned by their office and decide only steps assigned to that office.
- Payment verification belongs to the resource-owning office, even when a support office completes the final operational step.
- OSG Admins handle OSG-assigned event reviews and OSG visitor operations; they cannot edit resources, offices, users, or workflows.
- Super Admins maintain system configuration but do not use requester or office transaction screens.
- The React route matrix controls usability. The local API and AWS Lambda handlers enforce the actual data and action boundaries.

## Role Permission Matrix

| Role | Allowed Screens | Data And Maintenance Scope |
| --- | --- | --- |
| Requester | Home, Browse Resources, New Request, My Requests, Calendar, Alerts, Profile | Own requests, receipts, and alerts |
| Office Admin | Dashboard, Approvals, Payments, Resources, Office Settings, Calendar, Activity, Profile | Assigned approval steps, owned-office payments and resources |
| Super Admin | Dashboard, Offices, Users & Roles, Approval Workflows, Coverage, Calendar, Activity, Profile | System configuration and reporting |
| OSG Admin | Dashboard, Visitor Requests, Event Reviews, Parking, Arrivals, Records, Activity, Profile | OSG steps and visitor operations |
| OSG Requester | Home, New Visitor Request, My Requests, Profile | Own visitor requests |

Local defense mode uses salted password hashes and expiring bearer sessions. Production mode uses University OIDC SSO at API Gateway, followed by a Users-table lookup in Lambda for the current Reservata role, office, and account status.
