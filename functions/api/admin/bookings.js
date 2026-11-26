import { requireAdmin, adminJson } from "../../_utils/admin-auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return adminJson({ error: "Booking database is unavailable." }, 503);
  try {
    const result = await env.DB.prepare(`
      SELECT reference, guest_name, guest_email, created_at, payment_notice_at
      FROM booking_requests
      WHERE proof_object_key IS NOT NULL AND proof_object_key != ''
      ORDER BY COALESCE(payment_notice_at, created_at) DESC
      LIMIT 250
    `).all();
    const receipts = (result.results || []).map(row => ({
      reference: row.reference,
      guest_name: row.guest_name,
      guest_email: row.guest_email,
      created_at: row.created_at,
      payment_notice_at: row.payment_notice_at
    }));
    return adminJson({ receipts, returned: receipts.length, limit: 250 });
  } catch (error) {
    console.error("Admin receipt list query failed:", error);
    return adminJson({ error: "Could not load submitted receipts." }, 500);
  }
}
