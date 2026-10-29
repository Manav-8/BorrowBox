# BorrowBox

BorrowBox is a local peer-to-peer borrowing and lending marketplace. It helps students, campus communities and neighbors find useful items nearby without buying something they only need temporarily.

## Project resources

[Open the BorrowBox project Google Drive folder](https://drive.google.com/drive/folders/15FKCbiFc0dA9atPv6W1FCU94x_-Ng_kp?usp=drive_link)

## Problem and solution

Useful equipment often sits unused while nearby people need it briefly. BorrowBox brings listings, borrowing requests and the people behind them together. A user can lend and borrow from the same account, with persistent, database-backed records and server-enforced permissions.

## Current implementation

This is an active implementation, not a mock-data demo. Public listing and request feeds read from PostgreSQL; account registration/login uses Argon2id and a signed HttpOnly cookie; owners can create/update listings and create dated requests; listing images use private Supabase Storage with signed reads; conversations, persistent messages, structured offers/counteroffers, availability-guarded bookings and verified Razorpay test payment routes are implemented in code. Empty feeds are genuinely empty when the database has no published records.

| Workflow | Status |
|---|---|
| Registration, login, logout, protected account lookup | Implemented in code; requires configured database to run |
| Listing create/edit, public browse/search/pagination | Create/update, private image upload, public search/pagination implemented; richer filtering and owner dashboard outstanding |
| Borrow request create/browse | Create/browse and request-to-listing conversation path implemented; explainable auto-matching/edit/cancel outstanding |
| Persistent Socket.IO chat | Conversation creation, history, participant authorization, persistence and UI implemented |
| Structured negotiation and auditable counteroffers | Offer history, counter/reject/accept transitions and UI implemented; requires database verification |
| Availability-aware booking | Server pricing and overlap exclusion migration implemented; deployment migration not yet applied |
| Razorpay test checkout | Server order, Checkout callback signature verification, captured-payment check and raw-body idempotent webhook implemented; no account credentials or real gateway test yet |
| Reviews, condition reports, moderation | Not yet implemented |

No service is reported as externally verified. The API refuses to start without its Supabase database URLs and auth secret; it does not fall back to fake records or simulated payment success. Payment verifies against Razorpay only when test credentials are configured. It does not implement lender payouts.

## Technology

- Web: React 18, TypeScript, Vite, React Router, responsive CSS.
- API: Node.js, Express, TypeScript, Socket.IO, Zod, Helmet, rate limiting.
- Data: Supabase-hosted PostgreSQL through Prisma 6 migrations.
- Authentication: Argon2id password hashing and signed HttpOnly session cookie.
- Payment gateway: Razorpay Standard Checkout implementation, platform-collected TEST MODE only; real gateway verification is pending account setup.
- Listing media: private Supabase Storage bucket with authenticated server-side upload and short-lived signed reads.

## Local development

Prerequisites: Node.js 20+ and npm.

1. Copy `.env.example` to `apps/api/.env` and fill in `DATABASE_URL`, `DIRECT_URL`, and a locally generated `JWT_ACCESS_SECRET`.
2. Install dependencies from the repository root with `npm install`.
3. Generate Prisma Client with `npm run db:generate`.
4. Apply the checked-in migration using `npm run db:migrate:deploy` (or use `npm run db:migrate:dev` while authoring a local migration).
5. Start both apps with `npm run dev`. Vite runs at `http://localhost:5173`; API runs at `http://localhost:4000`.
6. API readiness is available at `http://localhost:4000/api/health`.

Full account, database, payment and deployment instructions are in [SETUP_GUIDE.md](SETUP_GUIDE.md). Do not send credentials in chat, commit `.env`, or expose any secret in frontend environment variables.

## Database

The Prisma schema is in `apps/api/prisma/schema.prisma`; migrations are in `apps/api/prisma/migrations`. The API uses `DATABASE_URL` at runtime and `DIRECT_URL` for Prisma migration operations. There is no SQLite or in-memory fallback. Listing and borrowing amounts are represented as integer paise. Booking terms snapshot fields are included in the schema so later listing changes cannot rewrite an agreement.

## Security notes

Password hashes use Argon2id. The API checks account status and authenticated identity on protected routes and object ownership on listing updates. Chat joins and sends require persisted conversation membership. Cookies are HttpOnly, SameSite=Lax locally and SameSite=None/Secure in production for separate Vercel/API origins; CORS and mutating request origins are limited to the configured `WEB_ORIGIN`. Razorpay secrets belong only in the API environment.

## Optional demo seed

The seed command requires an existing user and is disabled by default. Set `SEED_DEMO_DATA=true` and `SEED_OWNER_ID` in the API environment to that account's ID, then run `npm run db:seed`. It creates one listing and one borrowing request for that account and never creates shared demo passwords.

## Checks and integration boundaries

`npm run typecheck`, `npm run build`, `npm run db:validate`, and code-level automated tests require no cloud credentials. Database connectivity, storage uploads, realtime cross-client behavior, provider webhooks, checkout and deployed origin configuration require actual configured services. Tests that validate local signature/pricing logic are not proof that the external gateway works.

## Deployment

Target: Vercel for `apps/web`, Render for the Node.js/Socket.IO API, Supabase PostgreSQL and a private Supabase Storage bucket. Configure `VITE_API_BASE_URL` at frontend build time and API secrets on Render. Set `WEB_ORIGIN` to the exact Vercel origin. Apply migrations with `npm run db:migrate:deploy` before opening traffic. Deploy instructions and provider-specific steps are in `SETUP_GUIDE.md`. No deployment has been performed or verified.

## Submission checklist


- [ ] Demo video URL: https://drive.google.com/drive/folders/15FKCbiFc0dA9atPv6W1FCU94x_-Ng_kp?usp=drive_link
- [ ] Technology stack: React, TypeScript, Express, PostgreSQL, Prisma, Supabase, Socket.IO, Razorpay TEST MODE
- [ ] Confirm `.env` and provider secrets are not in repository history.
- [ ] Confirm real service checks are documented separately from mocked/unit checks.

## Demo script (3–5 minutes)

1. (30 sec) Introduce the problem and show the marketplace’s neighborhood search and honest empty state.
2. (50 sec) Register a demo account and show the same account can act as lender or borrower.
3. (50 sec) Publish an item with price, condition and pickup area; show it in the live database-backed feed.
4. (40 sec) Create a borrowing request with dates and budget; show it in the open requests feed.
5. (50 sec) Demonstrate participant-only conversation, persistent chat and proposed/countered offer history after Supabase is configured.
6. (50 sec) Demonstrate server-calculated availability/booking and Razorpay test checkout after Razorpay TEST MODE setup. Show a verified payment state only after it is received; never imply live payouts.
7. (20 sec) Close with the architecture, deployment links, and limitations recorded in `IMPLEMENTATION_STATUS.md`.
