# BorrowBox Architecture

## Runtime
- `apps/web`: React + TypeScript + Vite. Public browser bundle contains only the API base URL and other non-secret public configuration.
- `apps/api`: Node.js + Express + TypeScript + REST routes. Authentication, authorization, input validation, pricing and payment verification are server-side.
- Supabase-hosted PostgreSQL accessed through Prisma. `DATABASE_URL` is the runtime pooler URL; `DIRECT_URL` is the direct connection used by Prisma migrations.
- Razorpay Standard Checkout is created and verified by the API. The platform-collected test-mode limitation is documented; lender payouts are out of scope.
- Listing images are uploaded through a size/type-limited authenticated API route to a private Supabase Storage bucket; the API returns short-lived signed read URLs.

## Core relationships
`User` owns many `Listing` and `BorrowRequest` records. `Conversation` connects two users and may refer to a listing/request; `Message` persists within a conversation. `Offer` stores immutable negotiated terms and links a counteroffer to its predecessor. `Booking` snapshots accepted terms and connects borrower, lender, listing and offer. `Payment` persists gateway identifiers and unique webhook event IDs for idempotency. `Review` references a completed booking.

## Security decisions
- Passwords are hashed with Argon2id. Short-lived signed access tokens are held in an HttpOnly, Secure-in-production, SameSite cookie; origin checks and CSRF protections apply to mutating cookie-authenticated requests.
- All private resource reads and mutations are checked against authenticated user identity in the API.
- Zod validates environment configuration and untrusted payloads. The API does not start when required database/auth configuration is absent and does not switch to mock data.
- Razorpay secret and webhook secret are server-only. Payment success is applied only after signature verification or a verified webhook; event processing is idempotent.
- Booking overlap is checked transactionally and reinforced with PostgreSQL exclusion constraints in the migration where supported.

## Data changes
Prisma schema and checked-in SQL migrations define cloud PostgreSQL state. Use `npm run db:migrate:deploy` in production and `npm run db:migrate:dev` locally. No local database fallback is provided.
