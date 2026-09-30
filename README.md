# RESERVATA

RESERVATA is a multi-office resource reservation and management application for facilities, vehicles, equipment, payment verification, and OSG visitor access.

## Technology Stack

- Frontend: React with JavaScript and Vite
- Local development backend: Node.js API, mock UST SSO provider, and JSON data file
- AWS backend: API Gateway, modular JavaScript Lambda functions, DynamoDB, and private S3 receipt storage
- Production authentication: configurable University OIDC SSO with RESERVATA-managed RBAC
- Frontend deployment target: Amazon S3 and CloudFront

Local defense mode uses an OAuth 2.0-style mock UST SSO Authorization Code flow with PKCE. The deployed mode is enabled through production environment variables and replaces the mock provider with the university OIDC endpoints.

## Run in VS Code

Open this folder:

```txt
C:\Users\Keeno\Documents\GitHub\RESERVATA
```

In the VS Code terminal, run:

```bash
npm install
npm start
```

Open `http://127.0.0.1:5178/`.

`npm start` launches Vite, the local API, and the mock UST identity provider. Select **Sign in with Mock UST SSO**, authenticate on the separate provider page, and return to RESERVATA automatically. Refreshing an authenticated tab keeps that account signed in until logout.

## Defense Accounts

These credentials exist only in the local mock identity provider. Before submission, the provider encrypts the password with an ephemeral RSA-OAEP public key, so the request payload contains `encrypted_password` ciphertext rather than a plaintext `password` field. The server decrypts it only for verification against the salted hashes in `data/accounts.json`; RESERVATA receives only the authenticated email and obtains its role and office from its own user record. Deployed AWS mode uses University SSO instead.

| Role | Email | Local password |
| --- | --- | --- |
| Requester (Student) | `student.body.requester@ust.edu.ph` | `Requester2026!` |
| Office Admin | `simbahayan.admin@ust.edu.ph` | `OfficeAdmin2026!` |
| EdTech Office Admin | `edtech.admin@ust.edu.ph` | `EdTech2026!` |
| Facilities Office Admin | `facilities.admin@ust.edu.ph` | `Facilities2026!` |
| Super Admin | `all.offices.admin@ust.edu.ph` | `SuperAdmin2026!` |
| OSG Admin | `osg.admin@ust.edu.ph` | `OsgAdmin2026!` |
| Requester (Student Org Rep) | `cics.visitor.requester@ust.edu.ph` | `Visitor2026!` |

Requester accounts carry an affiliation (Student, Faculty, Staff, or Student Org Rep). Students may only browse and reserve Equipment resources and cannot access visitor requests; Faculty, Staff, and Student Org Rep requesters have full resource access plus the ability to submit and track visitor access requests.

## Available Commands

```bash
npm start       # React development server plus local API
npm run build   # Production frontend build in dist/
npm run check   # Production build and backend syntax checks
npm run api     # Local API only
npm run aws:test # AWS backend authorization and booking-lock tests
```

## Demonstration Roles

- Requester: browse resources, submit reservations, track requests, and upload receipt simulations. Student requesters are limited to Equipment resources; Faculty, Staff, and Student Org Rep requesters can also submit and track visitor access requests
- Office Admin: decide assigned approval steps, verify owned-office payments, and add, edit, archive, or restore office resources
- Super Admin: maintain offices, account roles, access, and requester affiliations, reusable approval workflows, coverage, and audit records
- OSG Admin: decide assigned event/security steps, approve visitor requests, allocate parking, and record arrivals

## Additional Requirements

Additional requirements are requester-selected routing triggers. For example, setup support can route a reservation to Facilities, while external visitors or visitor parking can route it to OSG. Super Admins can add, edit, activate, or archive these options in Approval Workflows; archiving hides an option from new request forms while preserving old workflow history.

## Project Structure

```txt
index.html                 Vite HTML entry point
src/main.jsx               React entry point
src/App.jsx                Application state and guarded navigation
src/components/            Login, application shell, and shared UI
src/views/                 Screens grouped by admin, dashboard, reservations, settings, visitors
src/services/              Local/AWS API adapters, SSO, and photo processing/uploads
src/domain/                Workflow rules and reservation draft, timeline, validation helpers
src/shared/                General utilities and unsaved-form navigation guards
src/data/                  Frontend demonstration defaults
src/styles/                Base stylesheet and portal overrides
src/store.js               Public entry point for the store
src/store/                 Business rules and data mutations grouped by domain
src/config.js              Roles, navigation, permissions, and page titles
public/                    Source static assets copied unchanged into each build
dist/                      Generated deployment output; do not edit (git-ignored)
server.js                  Local development API
dev-server.js              One-command local frontend/API launcher
aws/template.yaml          SAM infrastructure for API Gateway, Lambda, DynamoDB, and S3
aws/backend/               JavaScript Lambda handlers, shared libraries, tests, and seed tool
data/db.json               Local development database
data/db.default.json       Clean demonstration seed
data/accounts.json         Salted local demonstration password hashes
docs/                      Architecture, API, schema, flows, tests, and traceability
```

## Current and Target Architecture

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for where to add or edit files. `public/images/` and `dist/images/` intentionally contain the same assets after a build: edit only `public/`, then run `npm run build`. The build also produces bundled JavaScript, CSS, and HTML in `dist/`. See [docs/FONTS.md](docs/FONTS.md) for optional licensed fonts.

The application contains both a complete local React demonstration and deployable AWS backend infrastructure. It does not claim that an AWS stack or University SSO client is already provisioned.

Follow [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md) after the university supplies AWS access and SSO configuration.
