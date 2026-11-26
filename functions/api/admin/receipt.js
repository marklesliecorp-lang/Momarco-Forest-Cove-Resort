import { requireAdmin, adminJson } from "../../_utils/admin-auth.js";

const SUPABASE_URL = "https://sihtnfghwmsybsqboghp.supabase.co";
const BUCKET = "momarco-payment-proofs";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return adminJson({ error: "Booking database is unavailable." }, 503);
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!serviceKey) return adminJson({ error: "Private receipt storage is not configured." }, 503);
  const reference = new URL(request.url).searchParams.get("reference") || "";
  if (!/^MFC-[A-Z0-9-]{8,60}$/.test(reference)) return adminJson({ error: "Invalid booking reference." }, 400);
  try {
    const booking = await env.DB.prepare("SELECT proof_object_key FROM booking_requests WHERE reference = ?").bind(reference).first();
    if (!booking?.proof_object_key) return adminJson({ error: "No payment receipt has been uploaded for this booking." }, 404);
    const objectKey = String(booking.proof_object_key).replace(/^\/+/, "");
    if (!objectKey || objectKey.split("/").some(part => part === "." || part === "..")) return adminJson({ error: "The saved receipt path is invalid." }, 400);
    const encodedPath = objectKey.split("/").map(encodeURIComponent).join("/");
    const receipt = await fetch(SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + encodedPath, {
      headers: { "apikey": serviceKey, "Authorization": "Bearer " + serviceKey }
    });
    if (!receipt.ok) return adminJson({ error: receipt.status === 404 ? "The saved payment receipt could not be found." : "Could not retrieve the payment receipt." }, receipt.status === 404 ? 404 : 502);
    const contentType = (receipt.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) return adminJson({ error: "The stored receipt format is not supported." }, 415);
    return new Response(receipt.body, { headers: {
      "content-type": contentType,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline; filename=\"" + reference + "-receipt\""
    }});
  } catch (error) {
    console.error("Admin receipt retrieval failed:", error);
    return adminJson({ error: "Could not retrieve the payment receipt." }, 500);
  }
}
