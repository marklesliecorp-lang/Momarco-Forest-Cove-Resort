const ADMIN_EMAIL = "markleslie.corp@gmail.com";
const COOKIE_NAME = "momarco_admin_session";
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", ...headers } });
const bytes = value => new TextEncoder().encode(value);
const decode = value => { const s = value.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)); };
async function sign(secret, expires) {
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes("momarco-admin:" + expires)));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function tokenFrom(request) {
  const part = (request.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE_NAME + "="));
  return part ? part.slice(COOKIE_NAME.length + 1) : "";
}
export async function requireAdmin(request, env) {
  const secret = String(env.ADMIN_PASSWORD || "");
  if (secret.length < 8) return { ok: false, response: json({ error: "Admin sign-in is not configured yet." }, 503) };
  const parts = tokenFrom(request).split(".");
  if (parts.length !== 2) return { ok: false, response: json({ error: "Please sign in to view receipts." }, 401) };
  try {
    const expires = Number(parts[0]);
    if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) throw new Error("Expired");
    const expected = decode(await sign(secret, expires)), actual = decode(parts[1]);
    if (expected.length !== actual.length) throw new Error("Invalid");
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ actual[i];
    if (mismatch) throw new Error("Invalid");
    return { ok: true, email: ADMIN_EMAIL };
  } catch {
    return { ok: false, response: json({ error: "Your admin session has expired. Please sign in again." }, 401, { "set-cookie": COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" }) };
  }
}
export const adminJson = (data, status = 200) => json(data, status);
