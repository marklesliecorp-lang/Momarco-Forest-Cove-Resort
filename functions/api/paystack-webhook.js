const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const toHex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

const safeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
};

export async function onRequestPost({ request, env }) {
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Webhook is not configured." }, 503);
  const signature = request.headers.get("x-paystack-signature") || "";
  const rawBody = await request.text();
  let key;
  try {
    key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PAYSTACK_SECRET_KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    if (!safeEqual(toHex(digest), signature.toLowerCase())) return json({ error: "Invalid signature." }, 401);
  } catch {
    return json({ error: "Webhook signature could not be verified." }, 401);
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid event payload." }, 400); }
  if (event.event !== "charge.success") return json({ received: true });
  const payment = event.data;
  if (!payment || payment.status !== "success" || typeof payment.reference !== "string") return json({ received: true });

  const booking = await env.DB.prepare("SELECT id, reference, amount_ngn_kobo, payment_status FROM booking_requests WHERE reference = ? LIMIT 1").bind(payment.reference).first();
  if (!booking) return json({ received: true });
  if (payment.currency !== "NGN" || payment.amount !== booking.amount_ngn_kobo || payment.reference !== booking.reference) return json({ error: "Payment details do not match the booking." }, 400);

  await env.DB.prepare("UPDATE booking_requests SET status = 'confirmed', payment_status = 'paid' WHERE id = ? AND reference = ? AND amount_ngn_kobo = ?").bind(booking.id, booking.reference, booking.amount_ngn_kobo).run();
  return json({ received: true });
}
