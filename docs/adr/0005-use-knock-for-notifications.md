# Use Knock for In-App and Email notifications behind a domain notification seam

We chose Knock (`@knocklabs/react` and `@knocklabs/node`) over Novu as Cadence's third-party notification provider because the team already has an active Knock account, its free tier (10,000 messages/month) places no cap on workflow count across our transactional, digest, Adherence Reminder (`delay` + `cancellation_key`), and Course Recommendation flows, and its React 19 SDK supports instant `userId` switching via DevUI.

## Consequences

All server-side notification triggers sit behind a deep domain module (`app/services/notifications.server.ts`) with two adapters: a Knock adapter when `KNOCK_SECRET_KEY` is configured and an in-memory adapter for `npm run test` and `npm run db:seed`. Notification preferences (Comment opt-out, Claimed Seat opt-out, Instructor Purchase digest frequency, Adherence Reminder opt-out, and Course Recommendation opt-out) are stored in Cadence's SQLite database as the source of truth so domain rules and tests remain deterministic without network calls.
