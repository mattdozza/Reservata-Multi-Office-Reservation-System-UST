# Test Plan

Use this checklist before presenting the application. Run `npm run check` first and perform the browser workflow tests with a clean demonstration database.

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

1. Login as OSG Requester.
2. Submit a visitor access request.
3. Login as OSG Admin.
4. Approve the visitor request.

Expected result:

- Visitor request changes from `Pending` to `Approved`.

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

Expected result:

- Role label changes and activity log records the update.

## TC-009 Data Persistence

Steps:

1. Make any change.
2. Refresh the browser.

Expected result:

- Change remains because it was saved through the local API to `data/db.json`.

## TC-010 Reset Demo Data

Steps:

1. Click Reset Demo Data.
2. Refresh the browser.

Expected result:

- Database returns to the default seed records.

## TC-011 Production Build

Steps:

1. Run `npm run build`.
2. Confirm the command completes successfully.
3. Confirm `dist/index.html` and versioned assets are generated.

Expected result:

- The React frontend compiles into static files suitable for Amazon S3 and CloudFront.

## TC-012 Responsive Layout

Steps:

1. Open the login screen at a 390 by 844 viewport.
2. Login as Requester.
3. Check the dashboard and navigation.

Expected result:

- No horizontal page overflow occurs.
- Email, password, show-password, and sign-in controls remain readable and operable.
- Navigation and content remain readable and operable.

## TC-013 AWS Backend Unit Tests

Steps:

1. Run `npm run aws:test`.
2. Review authorization and reservation-slot test output.

Expected result:

- All backend tests pass.
- Wrong roles and offices are rejected.
- Invalid or excessive booking ranges are rejected.
- Correct 15-minute lock keys are generated.

## TC-014 AWS Template Validation

Steps:

1. Install AWS SAM CLI.
2. Run `sam validate --lint --template-file aws/template.yaml`.
3. Run `sam build --template-file aws/template.yaml`.

Expected result:

- The SAM template passes linting.
- All JavaScript Lambda dependencies are installed and build artifacts are generated.

## TC-015 University SSO and Cloud RBAC

Steps:

1. Deploy a non-production AWS stack with the university OIDC issuer and audience.
2. Sign in with one test account for each role.
3. Attempt an allowed and forbidden action for each account.

Expected result:

- API Gateway rejects invalid or expired tokens.
- Lambda rejects roles outside the action's permission list.
- Office Admin actions are limited to the assigned office.
- Requester records are limited to the authenticated email.

## TC-016 Conditional Multi-Office Approval

Steps:

1. As Requester, reserve Multipurpose Hall and select setup support, external guests, and visitor parking.
2. Confirm the preview contains one Simbahayan owner step followed by Facilities and two OSG steps at sequence 2.
3. Approve the owner step as the Simbahayan Office Admin.
4. Approve the setup step as the Facilities Office Admin.
5. Approve both event steps as OSG Admin.

Expected result:

- Sequence 2 steps activate together only after owner approval.
- Every account sees only its assigned pending step or steps.
- The reservation becomes `For Payment` only after all four steps are approved.
- A payment record is created with `Awaiting Receipt`, not `Pending Verification`.

## TC-017 Office Resource Maintenance

Steps:

1. Sign in as an Office Admin and open Office Settings.
2. Add a resource with a workflow assignment.
3. Edit its status, capacity, fee, or workflow.
4. Archive it, then edit it back to `Available`.

Expected result:

- Changes persist and create audit entries.
- The resource always remains assigned to the administrator's office.
- Archived resources are unavailable to requesters but remain available for audit and restoration.

## TC-018 Super Admin Maintenance

Steps:

1. Add or edit an office and change its Active/Inactive status.
2. Change another account's supported role and Active/Inactive status.
3. Create a workflow with an owner step and two support steps sharing sequence 2.
4. Edit and archive the unused workflow.

Expected result:

- Super Admin configuration persists and is audited.
- The signed-in Super Admin cannot deactivate or change their own role from the screen.
- Existing reservations retain their snapshotted route after a template edit.
