# Say-No-To-Impersonation-and-Scams-Trust-Layer-for-Twitter-and-Telegram

```md
# Say No To Impersonation — Trust Layer for Twitter + Telegram

A small backend service that lets users prove they control a Twitter (X) account by replying with a one-time verification code to a pinned tweet, then (optionally) link that proof to Telegram later.

✅ No OAuth / no signup required  
✅ Stores permanent Twitter `user_id` (username can change, ID won’t)  
✅ Uses Supabase Postgres for storage  
✅ Uses twitterapi.io for reading tweet replies (cheap alternative)

---

## How it works (high level)

1) Client calls **Create Session** → server creates `session_id` + `code` + returns `tweet_text`
2) User replies to the pinned verification tweet with that exact `tweet_text`
3) Client calls **Confirm by Reply** → server fetches pinned tweet replies and matches the code
4) Server stores `twitter_user_id` + `twitter_username` and marks session `twitter_ok`
5) (Next step) Telegram bot can confirm Telegram `user_id`, then we finalize an `identity_links` record

---

## Tech Stack

- Node.js + Express
- Supabase Postgres
- twitterapi.io (replies fetch)
- Axios
- UUID

---

## Project structure

```

social-verify/
src/
index.js
db.js
package.json
.env   (NOT committed)

````

---

## Local Setup (GitHub Codespaces friendly)

### 1) Install dependencies

```bash
cd social-verify
npm install
````

### 2) Create `.env` (IMPORTANT: do NOT commit this)

Create `social-verify/.env`:

```env
# Supabase Postgres (use Pooler URL)
DATABASE_URL=postgresql://...

# twitterapi.io
TWITTERAPI_IO_KEY=YOUR_TWITTERAPI_IO_KEY

# Pinned tweet ID (the tweet users will reply to)
VERIFICATION_TWEET_ID=2018185664630821065

# Optional: X official API bearer (not required for reply-check flow)
TWITTER_BEARER_TOKEN=
```

✅ NOTE: Use Supabase **Pooler** connection string in Codespaces/VPS.
If direct DB host gives ENETUNREACH, Pooler fixes it.

---

## Supabase DB Setup

Open **Supabase Dashboard → SQL Editor** and run:

### A) `sessions` table

```sql
create table if not exists public.sessions (
  session_id uuid primary key,
  code text not null,
  expires_at bigint not null,
  status text not null default 'pending',
  created_at bigint not null,
  twitter_user_id text,
  twitter_username text,
  telegram_user_id text,
  telegram_username text
);
```

### B) `identity_links` table

```sql
create extension if not exists pgcrypto;

create table if not exists public.identity_links (
  link_id uuid primary key default gen_random_uuid(),
  twitter_user_id text not null,
  telegram_user_id text not null,
  twitter_handle_last text,
  telegram_username_last text,
  verified_at bigint not null,
  status text not null default 'active'
);
```

---

## Run locally

```bash
node src/index.js
```

Server should start on:

* [http://localhost:3000](http://localhost:3000)

---

## API Endpoints

### 1) Create session

```bash
curl -X POST http://localhost:3000/v1/sessions
```

Response example:

```json
{
  "session_id": "....",
  "code": "K24XQL",
  "expires_at": 1770010301711,
  "tweet_text": "verify:kazar:<session_id>:K24XQL"
}
```

---

### 2) User replies to pinned tweet

User replies to the pinned tweet (ID = `VERIFICATION_TWEET_ID`) with **exact** `tweet_text`.

Example reply:

```
verify:kazar:<session_id>:K24XQL
```

---

### 3) Confirm by reply (Twitter verification)

```bash
curl -X POST http://localhost:3000/v1/sessions/<SESSION_ID>/twitter/confirm-by-reply
```

✅ Success example:

```json
{
  "ok": true,
  "verified": true,
  "twitter_user_id": "1816486117883183104",
  "twitter_username": "testingtradeson"
}
```

⏳ Not found yet:

```json
{ "ok": true, "verified": false, "message": "no matching reply found yet" }
```

🚦 Rate limit:

```json
{
  "ok": false,
  "error": "TWITTERAPI_RATE_LIMIT",
  "message": "twitterapi.io rate limit hit. Wait 30–60 seconds and try again."
}
```

**Important:** twitterapi.io free tier can be **1 request per 5 seconds**.
So don’t spam confirm calls.

---

### 4) Get session status

```bash
curl http://localhost:3000/v1/sessions/<SESSION_ID>
```

---

### 5) Verify by twitter user ID (after linking)

```bash
curl http://localhost:3000/v1/verify/twitter-id/<TWITTER_USER_ID>
```

Returns:

```json
{ "verified": true }
```

---

## Deployment Guide (simple)

You can deploy this Node server to:

* Railway / Render / Fly.io / VPS / any Node host

### Environment Variables on deploy host

Set these on your deployment dashboard:

* `DATABASE_URL`
* `TWITTERAPI_IO_KEY`
* `VERIFICATION_TWEET_ID`
* (optional) `TWITTER_BEARER_TOKEN`

### Start Command

Use:

```bash
node src/index.js
```

If your platform uses `PORT`, update `index.js` to:

```js
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
```

---

## .gitignore (important)

Make sure `.env` is ignored.

Example `.gitignore`:

```
node_modules
.env
.DS_Store
```

---

## Notes / Roadmap

* Replace mock finalize flow to use real `sessions.twitter_user_id`
* Add Telegram bot `/start <code>` flow to confirm Telegram user_id
* Add a simple web UI: input username → show code → check status
* Add cooldown to avoid twitterapi.io free-tier QPS limits

---

## License

MIT (or choose your own)

```

---

If you want, I can also give you:
- a clean `.gitignore` file content (ready),
- a `deploy.md` for Railway/Render specifically,
- and a “one-command local dev” via `npm run dev` (nodemon).
```
