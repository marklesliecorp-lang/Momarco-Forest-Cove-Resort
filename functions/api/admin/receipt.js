import { requireAdmin, adminJson } from "../../_utils/admin-auth.js";

const SUPABASE_URL = "https://sihtnfghwmsybsqboghp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_6aV0ZkCoFhu7lCUK5KJhHA_I81UBL6m";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return adminJson({ error: "Booking database is unavailable." }, 503);

  const reference = new URL(request.url).searchParams.get("reference") || "";
  if (!/^MFC-[A-Z0-9-]{8,60}$/.test(reference)) return adminJson({ error: "Invalid booking reference." }, 400);

  try {
    const booking = await env.DB.prepare("SELECT proof_object_key FROM booking_requests WHERE reference = ?").bind(reference).first();
    if (!booking?.proof_object_key) return adminJson({ error: "No payment receipt has been uploaded for this booking." }, 404);

    const receiptUrl = new URL(SUPABASE_URL + "/functions/v1/momarco-receipts");
    receiptUrl.searchParams.set("reference", reference);
    receiptUrl.searchParams.set("objectKey", booking.proof_object_key);

    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return adminJson({ error: "Administrator sign-in required." }, 401);

    const receipt = await fetch(receiptUrl, {
      headers: {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + SUPABASE_PUBLISHABLE_KEY,
        "Cf-Access-Jwt-Assertion": token
      }
    });
    if (!receipt.ok) {
      const detail = await receipt.json().catch(() => ({}));
      return adminJson({ error: detail.error || "Could not retrieve the payment receipt." }, receipt.status);
    }

    const contentType = receipt.headers.get("content-type") || "application/octet-stream";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) return adminJson({ error: "The stored receipt format is not supported." }, 415);
    return new Response(receipt.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline; filename=\"" + reference + "-receipt\""
      }
    });
  } catch (error) {
    console.error("Admin receipt retrieval failed:", error);
    return adminJson({ error: "Could not retrieve the payment receipt." }, 500);
  }
}
