const COOKIE_NAME = "momarco_admin_session";
export async function onRequestPost({ request }) {
  const origin = request.headers.get("Origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return Response.json({ error: "Request origin not allowed." }, { status: 403 }); }
    catch { return Response.json({ error: "Request origin is invalid." }, { status: 403 }); }
  }
  return Response.json({ ok: true }, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
    }
  });
}
