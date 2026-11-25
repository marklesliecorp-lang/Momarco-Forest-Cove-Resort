const page = (title, message, reference = "") => {
  const safeReference = String(reference).replace(/[^A-Za-z0-9-]/g, "");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#11112d"><title>${title} | Momarco Forest Cove Resort</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11112d;color:#fff;font:16px/1.6 Arial,sans-serif;padding:24px;box-sizing:border-box}.card{width:min(100%,520px);padding:32px;border:1px solid #393956;border-radius:18px;background:#191936;text-align:center}h1{font-size:28px;margin:0 0 12px}.ref{color:#f29ac0;font-weight:700;letter-spacing:.04em;margin:22px 0}a{display:inline-block;color:#11112d;background:#f29ac0;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p>${safeReference ? `<p class="ref">Booking reference: ${safeReference}</p>` : ""}<a href="/index.html">Return to resort website</a></main></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};

export async function onRequestGet({ request, env }) {
  const reference = new URL(request.url).searchParams.get("reference") || "";
  if (!/^[A-Za-z0-9-]{8,80}$/.test(reference)) return page("Payment not verified", "We could not identify this payment. Please contact the resort before trying again.");
  if (!env.PAYSTACK_SECRET_KEY) return page("Payment pending", "The resort payment verification service is not configured yet. Please contact the resort with your payment reference.", reference);

  const booking = await env.DB.prepare("SELECT id, reference, amount_ngn_kobo, payment_status FROM booking_requests WHERE reference = ? LIMIT 1").bind(reference).first();
  if (!booking) return page("Booking not found", "We could not find a booking for this payment reference. Please contact the resort.", reference);
  if (booking.payment_status === "paid") return page("Booking confirmed", "Your payment has already been verified successfully. Please present this reference at reception.", reference);

  let verification;
  try {
    const response = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
      headers: { "authorization": "Bearer " + env.PAYSTACK_SECRET_KEY, "accept": "application/json" }
    });
    verification = await response.json();
    if (!response.ok || !verification.status) return page("Payment not confirmed", "Paystack has not confirmed this payment yet. Do not make another payment until you contact the resort.", reference);
  } catch {
    return page("Payment verification pending", "We could not verify the payment just now. Please contact the resort with your reference before trying again.", reference);
  }

  const paid = verification.data;
  if (paid.status !== "success" || paid.reference !== reference || paid.currency !== "NGN" || paid.amount !== booking.amount_ngn_kobo) {
    return page("Payment not confirmed", "The payment details did not match the booking. Please contact the resort with this reference. Do not pay again yet.", reference);
  }

  await env.DB.prepare("UPDATE booking_requests SET status = 'confirmed', payment_status = 'paid' WHERE id = ? AND reference = ? AND amount_ngn_kobo = ?").bind(booking.id, reference, booking.amount_ngn_kobo).run();
  return page("Booking confirmed", "Your Paystack payment has been verified successfully. Your reservation is confirmed. Please present this booking reference at reception when you arrive.", reference);
}
