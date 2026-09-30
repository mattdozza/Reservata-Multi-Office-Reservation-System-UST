# Test Plan

Use this checklist before presenting the application. Run `npm run check` first and perform the browser workflow tests with a clean demonstration database.

## Resource Photos, Drafts, and History

The local API tests use a temporary database copy, not the running application's database. The browser checklist below remains manual; no end-to-end browser test runner has been added.

1. As an Office Admin, open Office Settings and create or edit a resource. Select a JPG, PNG, or WebP up to 5 MB. Check the preview, save, reopen, and confirm the photo persists. Remove the photo and confirm the placeholder returns.
2. As a requester, combine office, minimum capacity, payment, and schedule filters. Confirm the selected resource photo appears in both browsing and the reservation form. A failed availability check must not enable submission.
3. Enter a reservation purpose and schedule, then navigate away. Cancel the unsaved-change warning to stay; accept it to leave. Return or refresh and confirm the draft is restored. Another account must not see it. Discard removes it; successful submission also clears it.
4. Submit an invalid form and confirm field feedback. During saving, repeated clicks must not send another action. On receipt upload failure, the selected file stays available for retry.
5. Open reservation details and the approval tracker. Confirm chronological submission, review, document, payment, and lifecycle history. Another reservation of the same resource must not contribute events.
6. In the AWS test environment, interrupt a receipt PUT to S3. The payment must stay Awaiting Receipt. Retry successfully, then confirm Pending Verification and the owning office notification. Deploy the updated template and frontend together for the new completion endpoint.

## TC-001 Login and RBAC

Steps:

1. Open `http://127.0.0.1:5178/`.
2. Sign in with each defense account listed in `README.md`.
3. Confirm the sidebar changes per role.
4. Refresh the browser.

Expected result:

- Each role sees only its relevant screens.
- A correct account loads its assigned role and office without a role-selection control.
- Refreshing keeps the valid tab session; Logout returns to the login screen.
- An incorrect password and an unauthenticated `/api/state` request are rejected.

## TC-001A Restricted Screen Access

Steps:

1. Login as Requester.
2. Confirm Approvals, Payments, Offices, Users & Roles, Visitor Requests, Parking, and Arrivals are not shown.
3. Login as Office Admin.
4. Confirm Visitor Requests, Parking, Arrivals, Offices, and Users & Roles are not shown.

Expected result:

- Restricted screens are not available in role navigation.
- The route guard prevents switching to screens outside the active role's allowed list.

## TC-002 Submit Reservation

Steps:

1. Login as Requester.
2. Open New Request.
3. Select a resource and date.
4. Confirm the daily slot grid refreshes with available and unavailable slots.
5. Fill time, quantity, purpose, and any additional requirements.
6. Submit.

Expected result:

- Request appears in My Requests with `Under Owner Review` and a visible approval trail.
- The selected slot is held immediately as unavailable for overlapping requests.

## TC-002A Availability Conflict And Alternatives

Steps:

1. Login as Requester.
2. Open New Request.
3. Select a resource/date/time that overlaps an existing `Under Owner Review`, `Under Additional Review`, `For Payment`, `Approved`, or `Confirmed` reservation.
4. Try to submit the request.
5. Select one of the suggested alternative slots.

Expected result:

- The selected conflicting slot is marked unavailable.
- Submission is disabled or rejected before a conflicting reservation is created.
- Suggested alternatives display available time slots and selecting one refreshes the form.

## TC-002B Student Requester Resource Restriction

Steps:

1. Login as a Requester whose affiliation is Student (`student.body.requester@ust.edu.ph`).
2. Open Browse Resources and New Request.
3. Login as a Requester whose affiliation is Faculty, Staff, or Student Org Rep.
4. Open Browse Resources and New Request.

Expected result:

- The Student account sees and can reserve only Equipment resources.
- The Faculty/Staff/Student Org Rep account sees and can reserve Equipment and Vehicle resources.

## TC-003 Prevent Invalid Time

Steps:

1. Login as Requester.
2. Create a request where end time is earlier than start time.
3. Submit.

Expected result:

- System rejects the request.

## TC-004 Office Approval

Steps:

1. Login as Office Admin.
2. Open Approval Queue.
3. Approve the pending Simbahayan owner step.

Expected result:

- The next configured sequence becomes pending, or the request becomes `Confirmed`/`For Payment` when the route is complete.

## TC-004A Expire Unfinished Reservations

Steps:

1. Seed or create a reservation whose scheduled end time has already passed while its status is still `Under Owner Review`, `Under Additional Review`, or `For Payment`.
2. Load the reservation list or availability endpoint.
3. Check a future availability query with an `Expired` reservation in the same time range.

Expected result:

- The overdue unfinished reservation changes to `Expired`.
- Pending or waiting approval steps become `Skipped`.
- Any awaiting payment handoff changes to `Expired`.
- Requester and office notifications plus audit activity are created.
- Expired reservations no longer appear in action queues, cannot accept receipts or supporting documents, and do not block availability.

## TC-004B Requester Cancellation And Reschedule

Steps:

1. Login as Requester.
2. Open My Requests.
3. Cancel an active upcoming reservation with a reason.
4. Reschedule a second active upcoming reservation to another available future time slot.

Expected result:

- The cancelled reservation changes to `Cancelled`, releases the time slot, and notifies the owning office.
- The rescheduled reservation returns to `Under Owner Review`, keeps its audit trail, and no longer blocks the old slot.

## TC-004C Completion, In-Use, No-Show, And Override

Steps:

1. Login as the owning Office Admin.
2. Open Calendar.
3. Mark a confirmed current reservation `In Use`, then `Completed`.
4. Mark a confirmed reservation whose start time has passed as `No Show` with a reason.
5. Manually cancel or expire an active reservation with a reason.

Expected result:

- Attendance states are reflected in the calendar and reservation history.
- Completed/no-show/cancelled/expired reservations stop blocking availability.
- Requester notifications and audit records are created for every lifecycle action.

## TC-004D Payment Deadline And Reminders

Steps:

1. Approve a fee-required reservation until it reaches `For Payment`.
2. As Super Admin, change the default payment window and confirm the setting persists after reload.
3. As Office Admin, set a paid resource payment-window override, or leave it blank to use the default.
4. Verify the payment handoff includes the effective deadline window.
5. Let the deadline pass without receipt upload, or seed an overdue payment deadline.
6. Load the reservation list.

Expected result:

- Awaiting receipt payments past the deadline change to `Expired`.
- The linked reservation changes to `Expired`.
- Requester reminder notifications are created before expiry.
- Invalid payment windows below 1 hour or above 168 hours are rejected.

## TC-005 Payment Verification

Steps:

1. Login as Office Admin.
2. Open Payment Verification.
3. Verify a pending payment.

Expected result:

- Payment changes to `Verified`.
- Related reservation changes to `Confirmed`.

## TC-005A Supporting Document Upload

Steps:

1. Login as Requester.
2. Open My Requests.
3. Upload a JPG, PNG, or PDF supporting document to an active reservation.
4. Open the reservation details.

Expected result:

- The uploaded document is associated with that reservation.
- Reservation details show the document as submitted.
- Unsupported file types are rejected.

## TC-006 Visitor Request

Steps:

1. Login as a Requester whose affiliation is Student Org Rep (`cics.visitor.requester@ust.edu.ph`).
2. Submit a visitor access request.
3. Login as OSG Admin.
4. Approve the visitor request.
5. Login as a Requester whose affiliation is Student (`student.body.requester@ust.edu.ph`).
6. Confirm New Visitor Request and My Visitor Requests are not shown.

Expected result:

- Visitor request changes from `Pending` to `Approved`.
- Student requesters cannot see or submit visitor requests.

## TC-007 Arrival Monitor

Steps:

1. Login as OSG Admin.
2. Open Arrival Monitor.
3. Check in an approved visitor.

Expected result:

- Visitor status changes to `Arrived`.

## TC-008 Super Admin Role Update

Steps:

1. Login as Super Admin.
2. Open Users & Roles.
3. Select a different role for another user.
4. Change a Requester account's affiliation (Student, Faculty, Staff, or Student Org Rep).

Expected result:

- Role label changes and activity log records the update.
- Changing a user's role to Requester without an affiliation defaults it to Student.
- Affiliation can only be set for accounts with the Requester role.

## TC-009 Data Persistence

Steps:

1. Make any change.
2. Refresh the browser.

Expected result:

- Change remains because it was saved through the local API to `data/db.json`.

## TC-010 Production Build

Steps:

1. Run `npm run build`.
2. Confirm the command completes successfully.
3. Confirm `dist/index.html` and versioned assets are generated.

Expected result:

- The React frontend compiles into static files suitable for Amazon S3 and CloudFront.

## TC-011 Responsive Layout

Steps:

1. Open the login screen at a 390 by 844 viewport.
2. Login as Requester.
3. Check the dashboard and navigation.

Expected result:

- No horizontal page overflow occurs.
- Email, password, show-password, and sign-in controls remain readable and operable.
- Navigation and content remain readable and operable.

## TC-012 AWS Backend Unit Tests

Steps:

1. Run `npm run aws:test`.
2. Review authorization and reservation-slot test output.

Expected result:

- All backend tests pass.
- Wrong roles and offices are rejected.
- Invalid or excessive booking ranges are rejected.
- Correct 15-minute lock keys are generated.

## TC-013 AWS Template Validation

Steps:

1. Install AWS SAM CLI.
2. Run `sam validate --lint --template-file aws/template.yaml`.
3. Run `sam build --template-file aws/template.yaml`.

Expected result:

- The SAM template passes linting.
- All JavaScript Lambda dependencies are installed and build artifacts are generated.

## TC-013A Mock UST SSO

Steps:

1. Start the local application and select **Sign in with Mock UST SSO**.
2. Confirm the browser opens the separate Mock UST Identity Provider page.
3. Cancel once and confirm RESERVATA returns to the login screen with an error message.
4. Start again, enter a defense account email and password, and continue.
5. Confirm the browser returns to RESERVATA and opens the correct role workspace.
6. Refresh, sign out, and try an incorrect password.

Expected result:

- The provider preserves OAuth state and requires Authorization Code + PKCE S256.
- The login request contains `encrypted_password` ciphertext and no plaintext `password` field; plaintext fallback submissions are rejected.
- Credentials are entered only on the mock provider page; the RESERVATA login page never accepts a password.
- The returned email maps to the role and office stored in RESERVATA; the user cannot choose either value.
- Authorization codes are short-lived, single-use, restricted to the local client and redirect origin, and cannot be exchanged with a wrong verifier.
- Refresh restores a valid session, logout invalidates it, and invalid credentials do not return an authorization code.

## TC-014 University SSO and Cloud RBAC

Steps:

1. Deploy a non-production AWS stack with the university OIDC issuer and audience.
2. Sign in with one test account for each role.
3. Attempt an allowed and forbidden action for each account.

Expected result:

- API Gateway rejects invalid or expired tokens.
- Lambda rejects roles outside the action's permission list.
- Office Admin actions are limited to the assigned office.
- Requester records are limited to the authenticated email.

## TC-015 Conditional Multi-Office Approval

Steps:

1. As Requester, reserve the Community Outreach Van and select setup support, external guests, and visitor parking.
2. Confirm the preview contains one Simbahayan owner step followed by Facilities and two OSG steps at sequence 2.
3. Approve the owner step as the Simbahayan Office Admin.
4. Approve the setup step as the Facilities Office Admin.
5. Approve both event steps as OSG Admin.

Expected result:

- Sequence 2 steps activate together only after owner approval.
- Every account sees only its assigned pending step or steps.
- The reservation becomes `For Payment` only after all four steps are approved.
- A payment record is created with `Awaiting Receipt`, not `Pending Verification`.

## TC-016 Office Resource Maintenance

Steps:

1. Sign in as an Office Admin and open Office Settings.
2. Add a resource and confirm the asset tag is generated automatically.
3. Edit the suggested asset tag if the office needs a specific inventory code, then add an optional serial number, comma-separated labels, and a workflow assignment.
4. Edit its status, capacity, fee, payment window, asset tag, labels, or workflow.
5. Search the resource list by asset tag, serial number, or label.
6. Archive it, then edit it back to `Available`.

Expected result:

- Changes persist and create audit entries.
- The resource always remains assigned to the administrator's office.
- Duplicate asset tags are rejected.
- Archived resources are unavailable to requesters but remain available for audit and restoration.

## TC-017 Super Admin Maintenance

Steps:

1. Add or edit an office and change its Active/Inactive status.
2. Change another account's supported role and Active/Inactive status.
3. Create a workflow with an owner step and two support steps sharing sequence 2.
4. Edit and archive the unused workflow.

Expected result:

- Super Admin configuration persists and is audited.
- The signed-in Super Admin cannot deactivate or change their own role from the screen.
- Existing reservations retain their snapshotted route after a template edit.
