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
13. The requester uploads a receipt before the payment deadline. The deadline uses the paid resource's payment-window override when present, otherwise the Super Admin default, and is capped by the reservation start time. The resource-owning Office Admin verifies the receipt and the request becomes `Confirmed`.
14. A requester may cancel or reschedule an active upcoming request. Cancellation releases the slot. Rescheduling releases the previous slot, reserves the new slot, and sends the request back to owner review.
15. If the scheduled end time or payment deadline passes before final confirmation, Reservata marks the request `Expired`, skips remaining pending/waiting approval steps, removes it from action queues, notifies the requester and resource-owning office, and releases the time slot for future reservations.
16. Confirmed reservations become `In Use` when the owning office starts the reservation, then `Completed` after use. Confirmed reservations that pass their start time without attendance can be marked `No Show`.
17. Owning Office Admins and Super Admins may manually cancel or expire active reservations with a required reason for emergencies, mistakes, or office closures.

Reminder behavior:

- Requesters are reminded when payment is awaiting a receipt.
- Requesters are reminded when a confirmed reservation is scheduled within 24 hours.
- Offices are reminded when a review has been waiting longer than 24 hours.

## Requester Calendar

The Requester Calendar plots the signed-in requester's own reservations on the month grid.

- `Reservation confirmed`: a confirmed or in-progress Vehicle reservation on its scheduled date.
- `Pick up equipment`: an Equipment reservation the requester picks up on its scheduled date.
- `Return equipment`: the same Equipment reservation once the owning office marks it `Completed`, or the return day of a multi-day loan.

Only `Confirmed`, `In Use`, and `Completed` reservations appear; pending, payment, rejected, cancelled, expired, and no-show requests stay in My Requests. Selecting a date lists that day's events with the resource, time, and current status. Office Admin, Super Admin, and OSG Admin accounts keep the operational calendar with its resource, status, and lifecycle controls.

Example vehicle route:

```txt
Requester submission
  -> Simbahayan owner review (sequence 1)
  -> OSG guest review + OSG parking review (sequence 2, parallel, when requested)
  -> Payment receipt and Simbahayan verification
  -> Confirmed reservation
```

## Administrative Maintenance

### Office Admin

1. Opens Office Settings.
2. Adds or edits resources owned by the assigned office.
3. Maintains resource asset tag, serial number, searchable labels, type, location, capacity, availability, fee, payment-window override, and approval-workflow assignment.
4. Archives records instead of physically deleting them, preserving reservation and audit references.
5. May restore an archived resource by editing its status.

### Super Admin

1. Adds, renames, activates, or archives offices.
2. Assigns supported roles to existing user accounts and activates or deactivates access.
3. Creates approval workflows with an owner step plus supporting-office steps.
4. Configures step sequence and conditions. Equal sequence values run in parallel.
5. Edits or archives unused workflow templates. Existing reservations retain their snapshotted route.
6. Sets the default payment-expiration window for paid reservations.
7. Reviews system-wide coverage and audit activity.

## OSG Visitor Flow

1. A Requester whose affiliation is Faculty, Staff, or Student Org Rep submits a visitor access request. Student requesters cannot access this flow.
2. OSG Admin approves or declines it.
3. Approved visitors may receive a parking bay.
4. OSG Admin records arrival and the status becomes `Arrived`.

OSG visitor processing is separate from reservation Event Reviews. Event Reviews appear only when a reservation workflow assigns an active guest, security, or parking step to OSG.

## RBAC Rules

- Users sign in with their own account and cannot select or self-assign a role.
- Requesters access only their reservations, payments, and notifications plus active reservable resources and workflows.
- Every Requester account has an affiliation: Student, Faculty, Staff, or Student Org Rep, set by a Super Admin.
- Student requesters may browse and reserve only Equipment resources, and cannot access visitor requests.
- Faculty, Staff, and Student Org Rep requesters may reserve Equipment and Vehicle resources, and may submit and track their own visitor access requests.
- Office Admins maintain only resources owned by their office and decide only steps assigned to that office.
- Payment verification belongs to the resource-owning office, even when a support office completes the final operational step.
- OSG Admins handle OSG-assigned event reviews and OSG visitor operations; they cannot edit resources, offices, users, or workflows.
- Super Admins maintain system configuration but do not use requester or office transaction screens.
- The React route matrix controls usability. The local API and AWS Lambda handlers enforce the actual data and action boundaries.

## Role Permission Matrix

| Role | Allowed Screens | Data And Maintenance Scope |
| --- | --- | --- |
| Requester | Home, Browse Resources, New Request, My Requests, Calendar, Alerts, Profile, plus New Visitor Request and My Visitor Requests for Faculty/Staff/Student Org Rep affiliations | Own requests, receipts, and alerts; Students are limited to Equipment resources and cannot access visitor requests |
| Office Admin | Dashboard, Approvals, Payments, Resources, Office Settings, Calendar, Activity, Profile | Assigned approval steps, owned-office payments and resources |
| Super Admin | Dashboard, Offices, Users & Roles, Approval Workflows, Coverage, Calendar, Activity, Profile | System configuration, reporting, and requester affiliation assignment |
| OSG Admin | Dashboard, Visitor Requests, Event Reviews, Parking, Arrivals, Records, Activity, Profile | OSG steps and visitor operations |

Local defense mode redirects to a mock UST identity provider. Its login form encrypts the submitted password with an ephemeral RSA-OAEP public key before the request is sent, and the server validates the decrypted value against a salted password hash. It returns a short-lived single-use authorization code, verifies OAuth `state` and PKCE S256 during the token exchange, and creates an expiring local bearer session. RESERVATA receives the authenticated email but never lets the user select a role. Production uses the same browser Authorization Code + PKCE client with University OIDC endpoints; API Gateway validates the JWT before Lambda looks up the email in the Users table for its role, office, and account status.
