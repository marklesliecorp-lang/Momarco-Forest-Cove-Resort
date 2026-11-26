const ADMIN_EMAIL = "markleslie.corp@gmail.com";
let cachedKeys = null;
let cachedAt = 0;

const decodePart = (part) => {
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const decodeJson = (part) => JSON.parse(new TextDecoder().decode(decodePart(part)));

async function signingKeys(teamDomain) {
  if (cachedKeys && Date.now() - cachedAt < 300000) return cachedKeys;
  const response = await fetch("https://" + teamDomain + "/cdn-cgi/access/certs", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Access signing keys are unavailable.");
  const data = await response.json();
  if (!Array.isArray(data.keys) || !data.keys.length) throw new Error("Access signing keys are invalid.");
  cachedKeys = data.keys;
  cachedAt = Date.now();
  return cachedKeys;
}

export async function requireAdmin(request, env) {
  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").trim().replace("https://", "").replace("http://", "").split("/")[0];
  const audience = String(env.ACCESS_AUD || "").trim();
  if (!teamDomain || !audience) return { ok: false, response: Response.json({ error: "Admin access is not configured yet." }, { status: 503, headers: { "cache-control": "no-store" } }) };

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, response: Response.json({ error: "Administrator sign-in required." }, { status: 401, headers: { "cache-control": "no-store" } }) };
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token.");
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    if (header.alg !== "RS256" || claims.iss !== "https://" + teamDomain || !Array.isArray(claims.aud) || !claims.aud.includes(audience)) throw new Error("Invalid token claims.");
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now)) throw new Error("Expired token.");
    if (String(claims.email || "").toLowerCase() !== ADMIN_EMAIL) throw new Error("Not an administrator.");
    const keys = await signingKeys(teamDomain);
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
    if (!jwk) throw new Error("Unknown signing key.");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, decodePart(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!valid) throw new Error("Invalid signature.");
    return { ok: true, email: ADMIN_EMAIL };
  } catch {
    return { ok: false, response: Response.json({ error: "Administrator authentication failed." }, { status: 403, headers: { "cache-control": "no-store" } }) };
  }
}

export const adminJson = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
