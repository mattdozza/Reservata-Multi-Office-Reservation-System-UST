# Requirements Traceability

| Capstone Requirement | Prototype Location |
| --- | --- |
| SSO and RBAC | Account login in `LoginScreen.jsx`, local authenticated sessions in `server.js`, guarded navigation in `App.jsx`, and production JWT/role checks in the Lambda backend |
| Requester dashboard | Requester role dashboard |
| Resource browsing | Resources view |
| RES-BOOK-01 View Resource Availability | New Reservation Request live availability panel, daily slot grid, suggested alternatives, local `/api/resources/{id}/availability`, and AWS `/resources/{id}/availability` |
| RES-BOOK-02 Submit Reservation Request | New Reservation Request form, `submitReservation()` in `src/store.js`, local API scoped mutation checks, and AWS `reservations.mjs` POST handler |
| RES-BOOK-03 Track Reservation Status | My Requests list, request detail modal, status filters, approval trail, payment state, and requester-scoped reservation APIs |
| RES-BOOK-04 Upload Supporting Documents / Payment Receipt | Upload Document and Upload Receipt actions in My Requests, local document/receipt validation and preview, AWS private S3 presigned document/receipt uploads, and payment verification queue |
| Reservation submission | New Reservation Request form |
| Double-booking prevention | `hasConflict()` and slot alternatives in `src/store.js`, full-database local API conflict checks, AWS resource-date conflict checks, and DynamoDB reservation-lock writes on submission |
| Multi-tier approval workflow | `src/domain/workflows.js`, per-request approval-step snapshots, and office-specific queues |
| Payment receipt upload | Upload Receipt simulation in My Requests |
| Payment verification | Payment Verification screen |
| Notifications | Alerts screen and notification count |
| Admin resource management | Office Settings add/edit/status/workflow/archive controls scoped to the owning office |
| Super Admin user management | Users & Roles role and account access controls |
| Office coverage management | Office Management add/edit/status/archive and Coverage screens |
| Approval workflow maintenance | Super Admin Approval Workflows editor for ordered, parallel, and conditional steps |
| OSG visitor request | OSG Requester New Visitor Request |
| OSG approval workflow | OSG Admin Visitor Requests and conditional Event Reviews |
| Parking allocation | Parking screen |
| Arrival monitoring | Arrival Monitor screen |
| Activity/audit logging | Activity Log screen |
| React frontend | JSX components in `src/components` and `src/views`, composed by `src/App.jsx` |
| Maintainability | Separate UI components, workflow views, business store, persistence adapter, local API, data, and documentation |
| AWS frontend readiness | `npm run build` produces static assets in `dist/` for S3 and CloudFront |
| Local demonstration mode | `server.js`, salted account hashes, expiring sessions, scoped mutations, and `data/db.json` run the complete workflow without AWS credentials |
| API Gateway | `AWS::Serverless::HttpApi` in `aws/template.yaml` with University JWT authorizer |
| Modular Lambda backend | Resource, reservation, payment, visitor, admin, and bootstrap handlers in `aws/backend/src/handlers` |
| DynamoDB persistence | Domain tables and transactional reservation locks in `aws/template.yaml` |
| Receipt storage | Private encrypted S3 bucket and five-minute presigned uploads in `payments.mjs` |
| Production RBAC | JWT identity plus Users-table role and office checks in `aws/backend/src/lib/auth.mjs` |
| Cost management | Pay-per-request tables and Application/Environment tags on AWS resources |
