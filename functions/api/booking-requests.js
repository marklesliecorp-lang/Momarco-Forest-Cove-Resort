const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const localToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
};

const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  try {
    if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Request origin not allowed." }, 403);
  } catch { return json({ error: "Request origin is invalid." }, 403); }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "Invalid request format." }, 415);
  if (Number(request.headers.get("content-length") || 0) > 16000) return json({ error: "Request is too large." }, 413);
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Online payments are not configured yet. Please contact the resort." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Please submit valid booking details." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Please submit valid booking details." }, 400);
  const name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const checkIn = body.check_in;
  const checkOut = body.check_out;
  const items = body.rooms;

  if (name.length < 2 || name.length > 120) return json({ error: "Enter your full name." }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (phone.length < 7 || phone.length > 40) return json({ error: "Enter a valid phone number." }, 400);
  if (!validDate(checkIn) || !validDate(checkOut) || checkIn < localToday() || checkOut <= checkIn) return json({ error: "Choose valid future check-in and check-out dates." }, 400);
  const nights = (Date.parse(checkOut + "T00:00:00Z") - Date.parse(checkIn + "T00:00:00Z")) / 86400000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) return json({ error: "The stay must be between 1 and 365 nights." }, 400);
  if (!Array.isArray(items) || items.length < 1 || items.length > 12) return json({ error: "Select at least one room type." }, 400);

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

  let totalPhp = 0;
  const calculated = [];
  for (const item of items) {
    const room = roomMap.get(item.room_type_id);
    if (!room || room.active !== 1 || item.guests_per_room > room.capacity) return json({ error: "The guest count exceeds the selected room capacity." }, 400);
    const lineTotal = item.quantity * room.nightly_rate * nights;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(totalPhp + lineTotal)) return json({ error: "The booking total is too large." }, 400);
    totalPhp += lineTotal;
    calculated.push({ room_type_id: room.id, quantity: item.quantity, guests_per_room: item.guests_per_room, nightly_rate: room.nightly_rate, line_total: lineTotal });
  }

  let fxResponse;
  try {
    fxResponse = await fetch("https://api.frankfurter.dev/v2/rates?base=PHP&quotes=NGN", { headers: { "accept": "application/json" }, cf: { cacheTtl: 3600, cacheEverything: true } });
  } catch { return json({ error: "The daily exchange rate is temporarily unavailable. Please try again shortly." }, 503); }
  if (!fxResponse.ok) return json({ error: "The daily exchange rate is temporarily unavailable. Please try again shortly." }, 503);
  const fxRows = await fxResponse.json();
  const fx = Array.isArray(fxRows) ? fxRows.find((row) => row.base === "PHP" && row.quote === "NGN") : null;
  if (!fx || !Number.isFinite(fx.rate) || fx.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fx.date || "")) return json({ error: "A PHP-to-NGN reference rate is not available today. Please try again later." }, 503);

  const amountNgn = Math.round(totalPhp * fx.rate * 100) / 100;
  const amountKobo = Math.round(amountNgn * 100);
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 100) return json({ error: "The payment amount is invalid." }, 400);

  const id = crypto.randomUUID();
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  const reference = "MFC-" + Date.now().toString(36).toUpperCase() + "-" + suffix;
  const siteUrl = new URL(request.url).origin;
  let paystack;
  try {
    const paymentResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { "authorization": "Bearer " + env.PAYSTACK_SECRET_KEY, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        callback_url: siteUrl + "/api/paystack-callback",
        metadata: { booking_reference: reference, php_total: totalPhp, ngn_amount: amountNgn, fx_rate: fx.rate, fx_rate_date: fx.date }
      })
    });
    paystack = await paymentResponse.json();
    if (!paymentResponse.ok || !paystack.status || !paystack.data?.access_code || paystack.data.reference !== reference) {
      return json({ error: "Paystack could not start the payment. Please try again." }, 502);
    }
  } catch { return json({ error: "We could not connect to Paystack. Please try again." }, 502); }

  const statements = [
    env.DB.prepare("INSERT INTO booking_requests (id, reference, guest_name, guest_email, guest_phone, check_in, check_out, nights, estimated_total, currency, status, exchange_rate, exchange_rate_date, amount_ngn_kobo, payment_reference, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PHP', 'pending_payment', ?, ?, ?, ?, 'pending')").bind(id, reference, name, email, phone, checkIn, checkOut, nights, totalPhp, fx.rate, fx.date, amountKobo, reference),
    ...calculated.map((item) => env.DB.prepare("INSERT INTO booking_request_rooms (request_id, room_type_id, quantity, guests_per_room, nightly_rate, line_total) VALUES (?, ?, ?, ?, ?, ?)").bind(id, item.room_type_id, item.quantity, item.guests_per_room, item.nightly_rate, item.line_total))
  ];
  try { await env.DB.batch(statements); } catch { return json({ error: "We could not save your booking. No payment has been taken. Please try again." }, 500); }

  return json({
    ok: true,
    reference,
    nights,
    php_total: totalPhp,
    currency: "PHP",
    exchange_rate: fx.rate,
    exchange_rate_date: fx.date,
    ngn_amount: amountNgn,
    ngn_kobo: amountKobo,
    access_code: paystack.data.access_code,
    payment_status: "pending"
  }, 201);
}
