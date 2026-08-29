# RESERVATA

RESERVATA is a multi-office resource reservation and management application for facilities, vehicles, equipment, payment verification, and OSG visitor access.

## Technology Stack

- Frontend: React with JavaScript and Vite
- Local development backend: Node.js API and JSON data file
- AWS backend: API Gateway, modular JavaScript Lambda functions, DynamoDB, and private S3 receipt storage
- Production authentication: configurable University OIDC SSO with RESERVATA-managed RBAC
- Frontend deployment target: Amazon S3 and CloudFront

Local defense mode remains available without AWS credentials. The deployed mode is enabled through production environment variables and uses the serverless resources in `aws/template.yaml`.

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

`npm start` launches both the Vite React frontend and the authenticated local development API. A new browser session opens at the login screen; refreshing an authenticated tab keeps that account signed in until logout.

## Defense Accounts

These credentials exist only in the local defense environment. Passwords are stored as salted hashes in `data/accounts.json`; deployed AWS mode uses University SSO instead.

| Role | Email | Local password |
| --- | --- | --- |
| Requester | `student.body.requester@ust.edu.ph` | `Requester2026!` |
| Office Admin | `simbahayan.admin@ust.edu.ph` | `OfficeAdmin2026!` |
| EdTech Office Admin | `edtech.admin@ust.edu.ph` | `EdTech2026!` |
| Facilities Office Admin | `facilities.admin@ust.edu.ph` | `Facilities2026!` |
| Super Admin | `all.offices.admin@ust.edu.ph` | `SuperAdmin2026!` |
| OSG Admin | `osg.admin@ust.edu.ph` | `OsgAdmin2026!` |
| OSG Requester | `cics.visitor.requester@ust.edu.ph` | `Visitor2026!` |

## Available Commands

```bash
npm start       # React development server plus local API
npm run build   # Production frontend build in dist/
npm run check   # Production build and backend syntax checks
npm run api     # Local API only
npm run aws:test # AWS backend authorization and booking-lock tests
```

## Demonstration Roles

- Requester: browse resources, submit reservations, track requests, and upload receipt simulations
- Office Admin: decide assigned approval steps, verify owned-office payments, and add, edit, archive, or restore office resources
- Super Admin: maintain offices, account roles and access, reusable approval workflows, coverage, and audit records
- OSG Admin: decide assigned event/security steps, approve visitor requests, allocate parking, and record arrivals
- OSG Requester: submit visitor access requests and track their status

## Additional Requirements

Additional requirements are requester-selected routing triggers. For example, setup support can route a reservation to Facilities, while external visitors or visitor parking can route it to OSG. Super Admins can add, edit, activate, or archive these options in Approval Workflows; archiving hides an option from new request forms while preserving old workflow history.

## Project Structure

```txt
index.html                 Vite HTML entry point
styles.css                 Shared responsive design
src/main.jsx               React entry point
src/App.jsx                Application state and guarded navigation
src/components/            Login, application shell, and shared UI
src/views/                 Role dashboards and workflow screens
src/store.js               Business rules and data mutations
src/api.js                 Persistence adapter
src/config.js              Roles, navigation, permissions, and page titles
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

The application contains both a complete local React demonstration and deployable AWS backend infrastructure. It does not claim that an AWS stack or University SSO client is already provisioned.

Follow [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md) after the university supplies AWS access and SSO configuration.
