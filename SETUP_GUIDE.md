# BorrowBox Setup Guide

This guide is for when the code is ready for external services. Do not send secrets in chat or commit `.env` files. Enter each secret directly into your local environment file or provider dashboard.

## Before external accounts
Install Node.js 20 LTS or newer and npm. From the repository root run `npm install`, then `npm run dev`. The frontend can be built without cloud credentials; the API requires its configured database and auth secret and will explain missing settings at startup. No mock persistence or fake payment mode is provided.

## Supabase database and image storage
1. Open [supabase.com](https://supabase.com/) and create an account, then choose **New project**. Select a project name, a strong database password, and a nearby region; save the password in a password manager.
2. In the project, click **Connect** at the top of the dashboard and choose **Session pooler**. Use that copied connection string for `DATABASE_URL`; it works for the persistent Render API and IPv4-only networks. For `DIRECT_URL`, use the direct connection string if your migration runner has IPv6/direct access. If not, use the Session pooler string there too. Copy the actual host, username and port shown by Supabase rather than composing a pooler hostname. Replace placeholders in `apps/api/.env` and keep the password private. [Supabase explains the connection modes and dashboard steps here](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. Open **Project Settings → API** and copy the Project URL and `service_role` key into `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the API environment. The service-role key bypasses row-level policies; it must remain server-side.
4. Open **Storage → New bucket**, create a private bucket named `listing-images`, then set `SUPABASE_STORAGE_BUCKET` to that name.
5. In the repository root run `npm run db:migrate:deploy`. Verify the command completes before starting the API. Never use `db push` on production data.

## Local API environment
1. Copy `.env.example` to `apps/api/.env`.
2. Generate a unique random `JWT_ACCESS_SECRET` locally (for example with a password manager) and enter it in that file.
3. Keep `WEB_ORIGIN=http://localhost:5173` and set `VITE_API_BASE_URL=http://localhost:4000` for local work.
4. Start with `npm run dev`. Check `http://localhost:4000/api/health` for API readiness and confirm database readiness is reported before trying registration.
5. Register a test account in the app; confirm login and protected profile access. Do not paste credentials into this guide or chat.

## Razorpay test mode
1. Open [razorpay.com](https://razorpay.com/) and create/sign into an account. Complete any requested test-account setup.
2. In the dashboard switch to **Test Mode**, open **Account & Settings → API Keys**, and generate keys. Put the Key ID and Key Secret into the API environment as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Do not put the secret in a `VITE_` variable.
3. Open **Account & Settings → Webhooks**, add the deployed API URL plus `/api/payments/webhook`, select the payment/order events listed in this project's payment docs, and enter a newly generated signing secret into `RAZORPAY_WEBHOOK_SECRET` on the API host.
4. Save the webhook and use its dashboard test delivery. Verify the API records the event once and duplicate delivery is idempotent. Checkout signature and amount validation must also pass before a booking can be marked paid.
5. Only use test credentials for development. This project collects platform payments for the test flow and does not implement lender payouts or split settlements.

## Vercel and API deployment
1. Push the reviewed repository to a private or public Git provider without `.env` files.
2. In [vercel.com](https://vercel.com/), import the repository and keep the project root at the repository root so npm workspaces and `vercel.json` are used. Add `VITE_API_BASE_URL` as a build-time variable pointing to the API's HTTPS URL for Socket.IO; REST API calls are proxied through the Vercel origin by `vercel.json` so browser session cookies remain same-site. Redeploy after changing it.
3. Create a [Render](https://render.com/) account and choose **New → Web Service**. Connect the repository. Keep Root Directory blank (repository root), set Build Command to `npm run build --workspace @borrowbox/api`, and Start Command to `npm run start --workspace @borrowbox/api`. This keeps npm workspace dependencies available and supports the API's Socket.IO server.
4. In the Render service's **Environment** tab, add the API variables from `.env.example`: Supabase `DATABASE_URL`/`DIRECT_URL`, a new production `JWT_ACCESS_SECRET`, the exact Vercel `WEB_ORIGIN`, and the Supabase Storage values. Add Razorpay TEST MODE API keys and webhook secret when you reach payment setup. Do not add service-role or Razorpay secrets to Vercel.
5. Apply migrations from a trusted environment with `npm run db:migrate:deploy` before using the API. Wait for a successful Render deploy and copy its HTTPS service URL. Update Vercel's `VITE_API_BASE_URL` to that URL and redeploy. Set `WEB_ORIGIN` in Render to the exact Vercel origin, without a trailing slash.
6. Configure the Razorpay webhook URL as the API HTTPS URL plus `/api/payments/webhook`.
7. Verify API health, registration/login, database persistence across reloads, Socket.IO connectivity and Razorpay test-mode payment. Record the actual URLs and results in `IMPLEMENTATION_STATUS.md`; do not report a service as verified before these checks pass.

## Verification boundaries
Unit/type/build/database-schema checks are code-level checks and can run without external accounts. Database connectivity, storage upload, deployed CORS/WebSocket behavior, Razorpay checkout and webhook delivery are integration checks and require real configured test services. Never use live Razorpay keys for project verification.
