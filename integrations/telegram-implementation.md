# Telegram integration plan (not implemented)

- Store bot token in server secret storage, never `NEXT_PUBLIC_` and never Git.
- Verify incoming Telegram webhook secret header; use allowlisted method/route and rate limits.
- Subscribe/unsubscribe commands with explicit consent and section selection; never reveal chat IDs.
- Create an event transaction when content is published; enqueue one job per event/target.
- Idempotency with `notification_jobs.dedupe_key` and retries with exponential backoff.
- Notify only opted-in subscribers to the relevant section; general notices to all.
- Deep links to `/lectures/[id]`, `/announcements`, `/exams`, `/assignments`.
- Test changes and cancellation scenarios, duplicate sends and bot downtime.
- The current `/notifications` screen displays links only; NO outbound Telegram calls.
