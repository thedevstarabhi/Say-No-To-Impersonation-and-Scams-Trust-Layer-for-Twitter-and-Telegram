require("dotenv").config();
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const pool = require("./db");
const axios = require("axios");
const app = express();
app.use(express.json());
console.log("DATABASE_URL loaded?", !!process.env.DATABASE_URL);


// ✅ Step 1 endpoint: create session + code
app.post("/v1/sessions", async (req, res) => {
  const session_id = uuidv4();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const expires_at = Date.now() + 10 * 60 * 1000; // 10 minutes
  const created_at = Date.now();

  await pool.query(
    `INSERT INTO public.sessions (session_id, code, expires_at, status, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [session_id, code, expires_at, "pending", created_at]
  );

  res.json({
    session_id,
    code,
    expires_at,
    tweet_text: `verify:kazar:${session_id}:${code}`,
  });
});


app.get("/v1/sessions/:id", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    "SELECT session_id, code, expires_at, status FROM sessions WHERE session_id = $1",
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "session not found" });
  }

  res.json(result.rows[0]);
});


app.post("/v1/sessions/:id/twitter/mock-confirm", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE sessions
     SET status = 'twitter_ok'
     WHERE session_id = $1
     RETURNING session_id, status`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "session not found" });
  }

  res.json(result.rows[0]);
});


app.post("/v1/sessions/:id/telegram/mock-confirm", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE sessions
     SET status = CASE
       WHEN status = 'twitter_ok' THEN 'complete'
       ELSE 'telegram_ok'
     END
     WHERE session_id = $1
     RETURNING session_id, status`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "session not found" });
  }

  res.json(result.rows[0]);
});


app.get("/v1/verify/twitter-id/:twitter_user_id", async (req, res) => {
  const { twitter_user_id } = req.params;

  const r = await pool.query(
    "SELECT 1 FROM identity_links WHERE twitter_user_id = $1 AND status = 'active' LIMIT 1",
    [twitter_user_id]
  );

  res.json({ verified: r.rows.length > 0 });
});





app.get("/", (req, res) => res.send("API running ✅"));


app.post("/v1/sessions/:id/finalize", async (req, res) => {
  const { id } = req.params;

  // 1) fetch session
  const sessionRes = await pool.query(
    "SELECT session_id, status FROM sessions WHERE session_id = $1",
    [id]
  );

  if (sessionRes.rows.length === 0) {
    return res.status(404).json({ error: "session not found" });
  }

  const session = sessionRes.rows[0];
  if (session.status !== "complete") {
    return res.status(400).json({ error: "session not complete yet" });
  }

  // 2) TEMP MOCK IDs (we will replace with real Twitter/Telegram IDs later)
  const twitter_user_id = "mock_twitter_id_" + id.slice(0, 8);
  const telegram_user_id = 999000111; // mock

  // 3) insert identity link
  const linkRes = await pool.query(
    `INSERT INTO identity_links
      (link_id, twitter_user_id, telegram_user_id, twitter_handle_last, telegram_username_last, verified_at, status)
     VALUES
      (gen_random_uuid(), $1, $2, $3, $4, $5, 'active')
     RETURNING link_id, twitter_user_id, telegram_user_id, status`,
    [
      twitter_user_id,
      telegram_user_id,
      "mock_handle",
      "mock_telegram",
      Date.now(),
    ]
  );

  res.json({ linked: true, ...linkRes.rows[0] });
});



app.get("/v1/twitter/resolve/:handle", async (req, res) => {
  const handle = req.params.handle.replace("@", "");

  try {
    const r = await axios.get(
      `https://api.x.com/2/users/by/username/${handle}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
        },
      }
    );

    // TEMP: return full response body so we can see shape
    return res.json({
      ok: true,
      status: r.status,
      body: r.data,
    });
  } catch (err) {
    // TEMP: return error body too
    return res.status(500).json({
      ok: false,
      message: err.message,
      status: err.response?.status,
      body: err.response?.data,
    });
  }
});





app.post("/v1/sessions/:id/twitter/confirm-by-reply", async (req, res) => {
  const { id } = req.params;

  // 1) Load session to get code
  const s = await pool.query(
    "SELECT session_id, code, created_at FROM sessions WHERE session_id = $1",
    [id]
  );
  if (s.rows.length === 0) return res.status(404).json({ error: "session not found" });

  const { code, created_at } = s.rows[0];
  const expected = `verify:kazar:${id}:${code}`;

  // 2) Call twitterapi.io to get replies of pinned tweet
  const tweetId = process.env.VERIFICATION_TWEET_ID;
  const apiKey = process.env.TWITTERAPI_IO_KEY;

  if (!tweetId || !apiKey) {
    return res.status(500).json({ error: "missing env VERIFICATION_TWEET_ID or TWITTERAPI_IO_KEY" });
  }

  // We’ll check up to 3 pages max to avoid burning credits
  let cursor = null;
  for (let page = 0; page < 1; page++) {
    const url = new URL("https://api.twitterapi.io/twitter/tweet/replies/v2");
    url.searchParams.set("tweetId", tweetId);
    url.searchParams.set("sortBy", "Latest"); // latest replies first
    if (cursor) url.searchParams.set("cursor", cursor);

    //const r = await axios.get(url.toString(), {
      //headers: { "x-api-key": apiKey }, // twitterapi.io auth header :contentReference[oaicite:1]{index=1}
      //timeout: 15000,
    //});



    let r;
try {
  r = await axios.get(url.toString(), {
    headers: { "x-api-key": apiKey },
    timeout: 15000,
  });
} catch (err) {
  const status = err.response?.status;
  const data = err.response?.data;

  if (status === 429) {
    return res.status(429).json({
      ok: false,
      error: "TWITTERAPI_RATE_LIMIT",
      message:
        "twitterapi.io rate limit hit. Wait 30–60 seconds and try again.",
      details: data,
    });
  }

  return res.status(500).json({
    ok: false,
    error: "TWITTERAPI_ERROR",
    status,
    details: data || err.message,
  });
}


    const body = r.data || {};
    const replies = (body.tweets || []).slice(0, 50); // docs show replies[]; keep fallback

    // 3) Find matching reply
    const match = replies.find((x) => {
      const text = x?.text || x?.full_text || x?.content || "";
      const ts = x?.created_at || x?.createdAt || null; // optional
      // If created_at exists and is older than session creation, ignore (anti-copy)
      if (ts) {
        const tms = typeof ts === "number" ? ts : Date.parse(ts);
        if (!Number.isNaN(tms) && created_at && tms < Number(created_at)) return false;
      }
      return text.includes(expected);
    });

    if (match) {
      const twitter_user_id =
  match?.author?.id ||
  match?.user?.id ||
  match?.author_id ||
  match?.user_id ||
  null;

const twitter_username =
  match?.author?.userName ||   // ✅ twitterapi.io uses userName
  match?.author?.username ||
  match?.user?.username ||
  match?.screen_name ||
  null;


      if (!twitter_user_id) {
        return res.status(500).json({ error: "matched reply found but author id missing", match });
      }

      // 4) Update session -> twitter_ok + store twitter identity
      await pool.query(
        `UPDATE sessions
         SET status = 'twitter_ok',
             twitter_user_id = $2,
             twitter_username = $3
         WHERE session_id = $1`,
        [id, String(twitter_user_id), twitter_username]
      );

      return res.json({
        ok: true,
        verified: true,
        twitter_user_id: String(twitter_user_id),
        twitter_username,
        matched_text_preview: (match?.text || match?.full_text || "").slice(0, 80),
      });
    }

    cursor = body.cursor || body.next_cursor || body.nextCursor || null;
    if (!cursor) break;
  }

  return res.json({ ok: true, verified: false, message: "no matching reply found yet" });
});



app.get("/v1/debug/twitterapi/replies", async (req, res) => {
  const tweetId = process.env.VERIFICATION_TWEET_ID;
  const apiKey = process.env.TWITTERAPI_IO_KEY;

  if (!tweetId || !apiKey) {
    return res.status(500).json({ error: "missing env VERIFICATION_TWEET_ID or TWITTERAPI_IO_KEY" });
  }

  const url = new URL("https://api.twitterapi.io/twitter/tweet/replies/v2");
  url.searchParams.set("tweetId", tweetId);
  url.searchParams.set("sortBy", "Latest");

  // IMPORTANT: try BOTH auth styles (some providers use one or the other)
  let r;
  try {
    r = await axios.get(url.toString(), {
      headers: {
        "x-api-key": apiKey,
        "Authorization": `Bearer ${apiKey}`,
      },
      timeout: 15000,
    });
  } catch (err) {
    return res.status(err.response?.status || 500).json({
      ok: false,
      status: err.response?.status,
      details: err.response?.data || err.message,
    });
  }

  const data = r.data || {};
  return res.json({
    ok: true,
    topLevelKeys: Object.keys(data),
    sample: JSON.stringify(data).slice(0, 1500), // first 1500 chars only
  });
});






app.listen(3000, () => console.log("Server running on http://localhost:3000"));
