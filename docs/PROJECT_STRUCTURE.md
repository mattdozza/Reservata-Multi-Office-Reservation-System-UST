# Project Structure

This organization changes file locations and imports, not the reservation workflow, roles, or stored data.

## Frontend Source

```text
src/
  main.jsx                 Mounts React and imports styles
  App.jsx                  Session, actions, and guarded navigation
  config.js                Roles, navigation, and page configuration
  package.json             Marks src JavaScript as ES modules for Node tests
  store.js                 Public entry point; exports ReservataStore
  components/              Reusable UI, shell, login, photo, and timeline components
  views/
    ViewRouter.jsx         Chooses the current screen
    admin/                 Accounts, offices, activity, and profile screens
    dashboard/             Role dashboards
    reservations/          Browsing, requests, approvals, payments, calendar, alerts
    settings/              Resource editor and approval-workflow settings
    visitors/              Visitor requests and arrival screens
  services/                Local API, AWS API, SSO, and resource-photo operations
  domain/
    workflows.js           Shared approval-route rules
    reservations/          Draft persistence, timeline assembly, form validation, requester calendar events
  store/                   State and domain mutations: resources, bookings, payments, etc.
  shared/                  Cross-feature utilities and unsaved-form guards
  data/                    Frontend demonstration defaults
  styles/
    base.css               Base styles, loaded first
    portal.css             Portal layout overrides, loaded second
```

Add a screen to its existing `views/` feature folder. Reusable React UI belongs in `components/`; server calls belong in `services/`; reservation-specific helpers belong in `domain/reservations/`. State mutations remain in the matching `store/` module. Do not create a new abstraction or folder for every small helper.

The grouped `*Views.jsx` modules are retained to keep this change limited to organization. They can be split when an individual screen needs substantial work.

## Public Versus Dist

- `public/` is source: images and optional licensed font files that retain their names and public URLs. For example, `public/images/LOGIN.png` is served at `/images/LOGIN.png`.
- `dist/` is output: `npm run build` generates production HTML, bundled JavaScript/CSS, and copies of public assets. Never edit those generated copies; the next build replaces them.
- Matching files under `public/images/` and `dist/images/` are expected, not two independent sources to maintain. Do not move `dist/assets/` back into `public/`.
- `dist/` is excluded from Git. Deploy its contents when publishing the frontend; commit source changes instead.
- Font instructions live in [FONTS.md](FONTS.md), outside `public/`, so documentation is not copied into the deployed website.

## Other Folders

- `data/` holds local database files and account records. Uploaded resource photos live in the git-ignored `data/resource-photos/`, not `public/`, so the API can enforce access checks.
- `server.js` is the local API, and `dev-server.js` starts the API and Vite together.
- `aws/` holds deployment infrastructure and Lambda backend code, separate from frontend source.
- `test/` holds local automated tests. AWS tests live in `aws/backend/test/`.
- `docs/` holds architecture, API, deployment, and testing documentation.

Run `npm run check` after moving modules. Run `npm start` for local development.
