import { requireAdmin, adminJson } from "../../_utils/admin-auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB || !env.PROOF_BUCKET) return adminJson({ error: "Private receipt storage is not configured yet." }, 503);
  const reference = new URL(request.url).searchParams.get("reference") || "";
  if (!/^MFC-[A-Z0-9-]{8,60}$/.test(reference)) return adminJson({ error: "Invalid booking reference." }, 400);
  try {
    const booking = await env.DB.prepare("SELECT proof_object_key FROM booking_requests WHERE reference = ?").bind(reference).first();
    if (!booking?.proof_object_key) return adminJson({ error: "No payment receipt has been uploaded for this booking." }, 404);
    const object = await env.PROOF_BUCKET.get(booking.proof_object_key);
    if (!object) return adminJson({ error: "The saved payment receipt could not be found." }, 404);
    const contentType = object.httpMetadata?.contentType;
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) return adminJson({ error: "The stored receipt format is not supported." }, 415);
    return new Response(object.body, {
      headers: {
        "content-type": contentType,
        "content-length": String(object.size),
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
