import { requireAdmin, adminJson } from "../../_utils/admin-auth.js";

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const origin = request.headers.get("Origin");
  try {
    if (origin && new URL(origin).host !== new URL(request.url).host) return adminJson({ error: "Request origin not allowed." }, 403);
  } catch { return adminJson({ error: "Invalid request origin." }, 403); }
  if (!env.DB || !env.PROOF_BUCKET) return adminJson({ error: "Payment verification is unavailable until private receipt storage is configured." }, 503);
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: "Invalid request." }, 400); }
  const reference = String(body?.reference || "").trim();
  if (!/^MFC-[A-Z0-9-]{8,60}$/.test(reference)) return adminJson({ error: "Invalid booking reference." }, 400);
  try {
    const booking = await env.DB.prepare("SELECT id, proof_object_key, payment_status FROM booking_requests WHERE reference = ?").bind(reference).first();
    if (!booking) return adminJson({ error: "Booking not found." }, 404);
    if (!booking.proof_object_key || booking.payment_status !== "submitted_for_verification") return adminJson({ error: "This booking has no payment receipt awaiting verification." }, 409);
    const receipt = await env.PROOF_BUCKET.head(booking.proof_object_key);
    if (!receipt) return adminJson({ error: "The uploaded receipt is missing from private storage." }, 409);
    const result = await env.DB.prepare("UPDATE booking_requests SET payment_status = 'paid', status = 'confirmed' WHERE id = ? AND payment_status = 'submitted_for_verification' AND proof_object_key IS NOT NULL").bind(booking.id).run();
    if (!result.meta?.changes) return adminJson({ error: "The booking payment status changed. Refresh and check it again." }, 409);
    return adminJson({ ok: true, reference, payment_status: "paid", status: "confirmed" });
  } catch (error) {
    console.error("Admin payment verification failed:", error);
    return adminJson({ error: "Could not verify this payment." }, 500);
  }
}
