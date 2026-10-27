# Implementation Status

## Current checkpoint
Phase 5 code-level readiness; core product flows are implemented. The next phase is configuring Supabase, then verifying the database and storage before moving on to Razorpay and deployment.

## Completed in code
- React/TypeScript/Vite frontend with responsive marketplace, listing and request forms, account/profile, feeds, chat/negotiation, booking and payment status views.
- Express/TypeScript REST API, Zod payload checks, protected account/listing/request/conversation/booking routes, request rate limits, Helmet, configured CORS and mutating-origin checks.
- Argon2id registration/login, signed HttpOnly session cookie, active-account checks and profile editing.
- Prisma/PostgreSQL model and initial SQL migration for users, listings, borrowing requests, conversations, messages, linked counteroffers, booking snapshots, payments, webhook events and reviews.
- Private Supabase Storage upload endpoint validates image type/signature and size; marketplace reads use short-lived signed URLs.
- Search/category/pagination APIs for public listings and requests; listing management and request cancellation.
- Request-to-listing conversation flow, persistent realtime chat, participant-only conversation access, and auditable offer/counter/reject/accept transitions.
- Offer acceptance computes days, item price, 8% service fee, deposit and total on the server. PostgreSQL exclusion constraint and transaction protect overlapping holds. Booking lifecycle endpoints cover handoff, return, completion and pre-payment cancellation.
- Razorpay test-mode order creation, Checkout callback HMAC verification, server-side payment fetch/amount/currency check, raw-body webhook HMAC verification and unique-event idempotency. Lender payouts are not implemented.
- Controlled optional seed script creates sample marketplace records for an existing user only; it never creates demo credentials.
- Setup guide, README, architecture, prioritized plan, submission checklist and demo outline.

## Code-level checks completed
- `npm run typecheck` — passed for API and web.
- `npm test` — 4 tests passed: Checkout signature validation, raw-body webhook signature validation, server price calculation, invalid period/unsafe amount rejection.
- `npm run db:validate` — passed with temporary syntactically valid PostgreSQL URL placeholders (no connection was made).
- `npm run db:generate` — passed.
- `npm run build` — passed for API and web production bundle.
- Startup without credentials — exited with the expected Supabase `DATABASE_URL` / `DIRECT_URL` setup instruction.

## Not externally verified
- No Supabase project, database connection, migration application, or Storage upload has been tested.
- No Razorpay account/keys, Checkout transaction, signature callback, or webhook delivery has been tested.
- No Vercel or API deployment has been created; no WebSocket deployment has been verified.
- No end-to-end tests against a real database are available yet. The four passing tests are unit/code-level checks and do not prove external integrations.

## Remaining product work / known limits
- Request-to-listing matching is initiated by users from the open request feed; automated scoring, duplicate-safe match notifications and expiry jobs are not implemented.
- Borrow requests can be created, browsed and cancelled; editing is not yet available.
- Listing image management supports create-time upload; edit workflow is limited to status and listing data submitted to the API.
- The SQL migration includes `btree_gist` exclusion and check constraints. It has not been applied to a Supabase database, so provider migration behavior still needs verification.
- Booking/payment code has focused unit tests but does not yet have mocked database transaction tests for concurrent bookings or repeated webhook processing.
- Platform-collected Razorpay TEST MODE only. No real lender split payments, payout or refund flow.
- Git metadata was absent from the initially empty workspace. The environment also marks `.git` read-only, so no repository history or commits were created.

## Exact next action
Begin external configuration one step at a time at Supabase. First create a project and save its database password privately. Then enter the two connection URLs into `apps/api/.env`, apply the migration, and verify `/api/health` plus registration before configuring Storage. Follow [SETUP_GUIDE.md](SETUP_GUIDE.md); do not share credentials in chat or commit `.env`.

## Dependency note
- npm reports 3 high advisories in Prisma CLI's pinned deepmerge-ts@7.1.5 dependency. The app's Zod dependency is on a patched release. Keep Prisma 6 for schema compatibility and revisit this CLI advisory when Prisma publishes a compatible dependency update.
