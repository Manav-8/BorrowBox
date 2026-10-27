# BorrowBox Project Plan

## Product
BorrowBox is a peer-to-peer marketplace for local communities and students to borrow and lend useful items temporarily. It supports lending and borrowing from the same account.

## Priorities
- **P0:** cloud PostgreSQL, authentication and authorization, listings and borrowing requests, persistent negotiation, availability-safe bookings, verified Razorpay test payments, runnable docs/build.
- **P1:** explainable request matching, expiry handling, reviews, return tracking, richer dashboards.
- **P2:** advanced recommendations, analytics, payouts, disputes, native clients.

## Phases
1. **Foundation:** TypeScript React/Vite frontend, Express API, Prisma/Supabase PostgreSQL, environment validation, health check, secure auth, shared validation, migrations.
2. **Marketplace:** authenticated listing and borrow-request workflows, search/filter/pagination, managed images.
3. **Negotiation:** matching, participant-only persistent chat and realtime delivery, auditable offer/counteroffer transitions.
4. **Bookings and payments:** availability checks, transaction-safe booking, Razorpay test checkout/signatures/webhooks/idempotency.
5. **Quality and submission:** business/security tests, responsive UI, demo script, submission checklist, docs.
6. **Deployment readiness:** Vercel frontend, API host, Supabase, provider environment settings and external integration verification.

## Current delivery approach
Implement in small verifiable increments. Never substitute fake records, localStorage persistence, or simulated payment success for required services. Missing runtime configuration must produce a clear setup error. Keep external-account verification explicitly outstanding until credentials and a deployed instance are available.
