# AWS Deployment Guide

## What Is Implemented

The `aws/` folder contains a deployable AWS Serverless Application Model application:

- API Gateway HTTP API with a University OIDC/JWT authorizer
- JavaScript Lambda functions using the Node.js 24 runtime
- DynamoDB tables for resources, reservations, reservation locks, payments, visitors, users, offices, approval workflows, notifications, and activity
- A private S3 bucket for payment receipts
- Role and office checks inside every Lambda workflow
- DynamoDB transactions and 15-minute reservation locks to prevent concurrent double booking
- On-demand DynamoDB billing, encryption, retained data resources, cost tags, and production point-in-time recovery

This code is not deployed until the group supplies an AWS account, AWS credentials, and University SSO values.

## Required Software

Install and configure:

1. AWS CLI
2. AWS SAM CLI
3. An AWS account with permission to deploy CloudFormation, Lambda, API Gateway, DynamoDB, S3, IAM, and X-Ray resources
4. University OIDC issuer, client ID/audience, authorization endpoint, token endpoint, and permitted redirect URL

The current machine did not have AWS CLI or SAM CLI installed, so cloud deployment was not performed here.

## Install Backend Dependencies

From the project folder:

```bash
cd aws/backend
npm install
cd ../..
```

## Configure SAM

Copy `aws/samconfig.toml.example` to `aws/samconfig.toml` and replace the placeholder University SSO values.

The default region is `ap-southeast-1`. Change it if the university requires another AWS region.

## Validate and Deploy

```bash
sam validate --lint --template-file aws/template.yaml
sam build --template-file aws/template.yaml
sam deploy --guided
```

During guided deployment, confirm:

- stack name such as `reservata-dev`
- deployment region
- `EnvironmentName`
- frontend `AllowedOrigin`
- `UniversitySsoIssuer`
- `UniversitySsoAudience`

Save the deployment configuration only after reviewing the generated CloudFormation change set.

## Seed Development Data

After deployment, copy the table names from the CloudFormation outputs into environment variables. In PowerShell:

```powershell
$env:RESOURCES_TABLE = "output-value"
$env:RESERVATIONS_TABLE = "output-value"
$env:RESERVATION_LOCKS_TABLE = "output-value"
$env:PAYMENTS_TABLE = "output-value"
$env:VISITORS_TABLE = "output-value"
$env:USERS_TABLE = "output-value"
$env:OFFICES_TABLE = "output-value"
$env:APPROVAL_WORKFLOWS_TABLE = "output-value"
$env:NOTIFICATIONS_TABLE = "output-value"
$env:ACTIVITY_TABLE = "output-value"
$env:SEED_CONFIRM = "reservata-dev"
npm --prefix aws/backend run seed
```

The confirmation value prevents accidental execution. Do not run the sample seed against production.

## Configure the React Frontend

Copy `.env.aws.example` to `.env.production` and replace every placeholder. The important values are:

- `VITE_API_BASE_URL`: API Gateway output URL
- `VITE_SSO_AUTHORIZE_URL`: University authorization endpoint
- `VITE_SSO_TOKEN_URL`: University token endpoint
- `VITE_SSO_CLIENT_ID`: Registered SPA client ID
- `VITE_SSO_REDIRECT_URI`: Final CloudFront application URL

Build the frontend:

```bash
npm run build
```

The `dist/` directory is ready for the frontend S3 bucket and CloudFront distribution. Update the API `AllowedOrigin` parameter to the exact CloudFront origin before production use.

## Authentication Flow

Local development runs this same browser flow against `/mock-sso/authorize` and `/mock-sso/token`. Setting the production API and SSO environment variables replaces those mock endpoints with the registered University provider; no mock credentials or mock authorization codes are deployed to AWS.

1. The React app creates an OAuth state value and PKCE verifier.
2. The browser redirects to University SSO.
3. The university redirects back with an authorization code.
4. The React app exchanges the code using the PKCE verifier.
5. API Gateway validates the returned JWT issuer and audience.
6. Lambda reads the authenticated email claim.
7. Reservata loads that email from the Users table and applies its stored role and office.

University SSO authenticates the person, but it does not create RESERVATA access by itself. The signed-in email must already exist as an active Users-table record. After the first Super Admin is seeded, only Super Admins can provision additional SSO accounts from the Users & Roles screen or `POST /users`.

If the university supports SAML but not OIDC for single-page applications, place Amazon Cognito federation between the University SAML provider and this application. The API authorizer can then use the Cognito issuer and application client audience.

## Production Checklist

- Replace all placeholder SSO values.
- Register the exact CloudFront callback and logout URLs with the university identity provider.
- Confirm the token contains an `email`, `preferred_username`, or `upn` claim.
- Provision the first Super Admin directly in the Users table, then create all other office accounts through the Super Admin Users & Roles screen.
- Enable production deployment so DynamoDB point-in-time recovery is active.
- Verify CloudWatch logs, X-Ray traces, alarms, and AWS Budgets.
- Run the role matrix and end-to-end tests against a non-production stack.
- Confirm receipt objects remain private and presigned upload URLs expire after five minutes.
