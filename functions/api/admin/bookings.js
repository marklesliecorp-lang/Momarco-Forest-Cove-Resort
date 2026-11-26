import { requireAdmin, adminJson } from "../../_utils/admin-auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return adminJson({ error: "Booking database is unavailable." }, 503);
  try {
    const result = await env.DB.prepare(`
      SELECT b.id, b.reference, b.guest_name, b.guest_email, b.guest_phone,
             b.check_in, b.check_out, b.nights, b.estimated_total, b.currency,
             b.status, b.payment_status, b.payment_method, b.payment_notice_at,
             b.created_at, b.proof_object_key,
             rr.quantity, rr.guests_per_room, rr.nightly_rate, rr.line_total,
             rt.name AS room_name
      FROM booking_requests b
      LEFT JOIN booking_request_rooms rr ON rr.request_id = b.id
      LEFT JOIN room_types rt ON rt.id = rr.room_type_id
      ORDER BY b.created_at DESC
      LIMIT 250
    `).all();
    const bookings = new Map();
    for (const row of result.results || []) {
      let booking = bookings.get(row.id);
      if (!booking) {
        booking = {
          reference: row.reference, guest_name: row.guest_name, guest_email: row.guest_email,
          guest_phone: row.guest_phone, check_in: row.check_in, check_out: row.check_out,
          nights: row.nights, estimated_total: row.estimated_total, currency: row.currency,
          status: row.status, payment_status: row.payment_status, payment_method: row.payment_method,
          payment_notice_at: row.payment_notice_at, created_at: row.created_at,
          has_receipt: Boolean(row.proof_object_key), rooms: []
        };
        bookings.set(row.id, booking);
      }
      if (row.room_name) booking.rooms.push({
        name: row.room_name, quantity: row.quantity, guests_per_room: row.guests_per_room,
        nightly_rate: row.nightly_rate, line_total: row.line_total
      });
    }
    const items = Array.from(bookings.values());
    return adminJson({
      bookings: items,
      counts: {
        total: items.length,
        awaiting_payment: items.filter((b) => b.payment_status === "awaiting_payment").length,
        submitted_for_verification: items.filter((b) => b.payment_status === "submitted_for_verification").length,
        paid: items.filter((b) => b.payment_status === "paid").length,
        confirmed: items.filter((b) => b.status === "confirmed").length
      },
      limit: 250
    });
  } catch (error) {
    console.error("Admin bookings query failed:", error);
    return adminJson({ error: "Could not load bookings." }, 500);
  }
}
