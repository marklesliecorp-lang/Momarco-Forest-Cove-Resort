const ADMIN_EMAIL = "markleslie.corp@gmail.com";
const COOKIE_NAME = "momarco_admin_session";
const SESSION_SECONDS = 12 * 60 * 60;

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", ...headers }
});

const toBase64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromBase64Url = value => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), c => c.charCodeAt(0));
};
const passwordBytes = value => new TextEncoder().encode(value);
async function signature(secret, expires) {
  const key = await crypto.subtle.importKey("raw", passwordBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, passwordBytes("momarco-admin:" + expires)));
}
function cookieValue(request) {
  const cookie = request.headers.get("Cookie") || "";
  const entry = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(COOKIE_NAME + "="));
  return entry ? entry.slice(COOKIE_NAME.length + 1) : "";
}
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function requireAdmin(request, env) {
  const secret = String(env.ADMIN_PASSWORD || "");
  if (secret.length < 8) return { ok: false, response: json({ error: "Admin sign-in is not configured yet." }, 503) };
  const parts = cookieValue(request).split(".");
  if (parts.length !== 2) return { ok: false, response: json({ error: "Please sign in to view receipts." }, 401) };
  try {
    const expires = Number(parts[0]);
    if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) throw new Error("Expired session");
    const expected = await signature(secret, expires);
    const actual = fromBase64Url(parts[1]);
    if (actual.length !== expected.length) throw new Error("Invalid session");
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ actual[i];
    if (mismatch) throw new Error("Invalid session");
    return { ok: true, email: ADMIN_EMAIL };
  } catch {
    return { ok: false, response: json({ error: "Your admin session has expired. Please sign in again." }, 401, { "set-cookie": COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" }) };
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin not allowed." }, 403);
  const secret = String(env.ADMIN_PASSWORD || "");
  if (secret.length < 8) return json({ error: "Admin sign-in is not configured yet." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Enter your admin email and password." }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const supplied = passwordBytes(password);
  const expected = passwordBytes(secret);
  let mismatch = supplied.length ^ expected.length;
  const length = Math.max(supplied.length, expected.length);
  for (let i = 0; i < length; i++) mismatch |= (supplied[i] || 0) ^ (expected[i] || 0);
  if (email !== ADMIN_EMAIL || mismatch !== 0) {
    await new Promise(resolve => setTimeout(resolve, 350));
    return json({ error: "The email or password is incorrect." }, 401);
  }
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = expires + "." + toBase64Url(await signature(secret, expires));
  return json({ ok: true, email: ADMIN_EMAIL }, 200, {
    "set-cookie": COOKIE_NAME + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS
  });
}

export const adminJson = (data, status = 200) => json(data, status);
