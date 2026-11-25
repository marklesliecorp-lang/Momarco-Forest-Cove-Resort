const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const localToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
};

const validDate = (value) => {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Request origin not allowed." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "Invalid request format." }, 415);
  if (Number(request.headers.get("content-length") || 0) > 16000) return json({ error: "Request is too large." }, 413);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Please submit valid booking details." }, 400); }
  const name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const checkIn = body.check_in;
  const checkOut = body.check_out;
  const items = body.rooms;

  if (name.length < 2 || name.length > 120) return json({ error: "Enter your full name." }, 400);
  if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (phone.length < 7 || phone.length > 40) return json({ error: "Enter a valid phone number." }, 400);
  if (!validDate(checkIn) || !validDate(checkOut) || checkIn < localToday() || checkOut <= checkIn) return json({ error: "Choose valid future check-in and check-out dates." }, 400);
  const nights = (Date.parse(checkOut + "T00:00:00Z") - Date.parse(checkIn + "T00:00:00Z")) / 86400000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) return json({ error: "The stay must be between 1 and 365 nights." }, 400);
  if (!Array.isArray(items) || items.length < 1 || items.length > 12) return json({ error: "Select at least one room." }, 400);

  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.room_type_id !== "string" || seen.has(item.room_type_id)) return json({ error: "Room selection is invalid." }, 400);
    seen.add(item.room_type_id);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.guests_per_room) || item.guests_per_room < 1) return json({ error: "Check the room quantity and guest count." }, 400);
  }

  const placeholders = items.map(() => "?").join(",");
  const roomResult = await env.DB.prepare("SELECT id, nightly_rate, capacity, active FROM room_types WHERE id IN (" + placeholders + ")").bind(...items.map((item) => item.room_type_id)).all();
  const roomMap = new Map((roomResult.results || []).map((room) => [room.id, room]));
  if (roomMap.size !== items.length) return json({ error: "One or more selected room types are unavailable. Please refresh and try again." }, 409);

  let total = 0;
  const calculated = [];
  for (const item of items) {
    const room = roomMap.get(item.room_type_id);
    if (!room || room.active !== 1 || item.guests_per_room > room.capacity) return json({ error: "The guest count exceeds the selected room capacity." }, 400);
    const lineTotal = item.quantity * room.nightly_rate * nights;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) return json({ error: "The booking total is too large." }, 400);
    total += lineTotal;
    calculated.push({ room_type_id: room.id, quantity: item.quantity, guests_per_room: item.guests_per_room, nightly_rate: room.nightly_rate, line_total: lineTotal });
  }

  const id = crypto.randomUUID();
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  const reference = "MFC-" + Date.now().toString(36).toUpperCase() + "-" + suffix;
  const statements = [
    env.DB.prepare("INSERT INTO booking_requests (id, reference, guest_name, guest_email, guest_phone, check_in, check_out, nights, estimated_total, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PHP', 'availability_pending')").bind(id, reference, name, email, phone, checkIn, checkOut, nights, total),
    ...calculated.map((item) => env.DB.prepare("INSERT INTO booking_request_rooms (request_id, room_type_id, quantity, guests_per_room, nightly_rate, line_total) VALUES (?, ?, ?, ?, ?, ?)").bind(id, item.room_type_id, item.quantity, item.guests_per_room, item.nightly_rate, item.line_total))
  ];
  await env.DB.batch(statements);
  return json({ ok: true, reference, nights, estimated_total: total, currency: "PHP", status: "availability_pending" }, 201);
}
