# Architecture

## Current Local Application

```txt
Browser
  -> Vite
  -> React + JavaScript components
  -> local Node.js API
  -> data/db.json
```

The current version runs locally so the group can demonstrate the complete role and workflow behavior without AWS credentials. The React production build is generated in `dist/` for later S3 deployment.

## AWS Capstone Architecture

```txt
Browser
  -> React.js frontend
  -> Amazon S3 static hosting
  -> Amazon CloudFront
  -> Amazon API Gateway
  -> AWS Lambda functions
  -> Amazon DynamoDB
  -> Amazon S3 for receipt/document uploads
  -> UST SSO for authentication
```

## Implemented AWS Backend

`aws/template.yaml` provisions an API Gateway HTTP API, six JavaScript Lambda functions, nine domain tables plus the reservation lock table, and private S3 receipt storage. API Gateway validates an OIDC JWT. Each Lambda then loads the authenticated email from the Users table and applies the Reservata role and office scope.

The React persistence layer automatically selects:

- local API mode when no `VITE_API_BASE_URL` is configured
- AWS mode when API Gateway and a University SSO client are configured

## Stack Alignment

- `src/main.jsx`, `src/App.jsx`, `src/components`, and `src/views` implement the required React and JavaScript frontend.
- `npm run build` creates static assets suitable for S3 and CloudFront.
- `server.js` remains a local development adapter; the corresponding JavaScript Lambda handlers are implemented in `aws/backend/src/handlers`.
- `data/db.json` is a local development adapter whose entities map to DynamoDB records.`r`n- `src/store.js` is a compatibility entry point; domain store behavior is split under `src/store/` into reservation, resource, payment, admin, visitor, notification, and shared helper modules.
- Named local defense accounts demonstrate RBAC while live University SSO configuration is unavailable; users never select their own role.
- React guards protect navigation in local mode. In AWS mode, every Lambda repeats role and office checks using the authenticated SSO identity and the Users table; frontend checks alone are never treated as security.

The frontend and AWS backend code now match the documented target stack. Actual AWS provisioning, CloudFront publication, and live University SSO registration remain external deployment steps and must not be presented as already live until completed in the university AWS environment.

## Main Modules

- Authentication and RBAC simulation
- Resource availability
- Reservation submission
- Configurable sequential and parallel office approval workflows
- Payment receipt verification
- Notification records
- OSG visitor request workflow
- Parking allocation
- Arrival monitoring
- Office Admin resource settings
- Super Admin office, account, and workflow management
- Activity/audit trail
