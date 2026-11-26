(() => {
  "use strict";
  const list = document.getElementById("booking-list");
  const alertBox = document.getElementById("admin-alert");
  const search = document.getElementById("booking-search");
  const filter = document.getElementById("booking-filter");
  const dialog = document.getElementById("receipt-dialog");
  const receiptContent = document.getElementById("receipt-content");
  const receiptTitle = document.getElementById("receipt-title");
  let bookings = [];
  let activeReceiptUrl = null;
  const money = value => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const statusLabel = value => String(value || "unknown").replace(/_/g, " ");
  const setAlert = (message, type = "") => { alertBox.textContent = message; alertBox.className = "admin-alert" + (type ? " " + type : ""); };
  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, { cache: "no-store", ...options, headers: { "Accept": "application/json", ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  };
  const render = () => {
    const term = search.value.trim().toLowerCase();
    const selected = filter.value;
    const visible = bookings.filter(booking => {
      const matchesTerm = [booking.reference, booking.guest_name, booking.guest_email, booking.guest_phone].some(value => String(value || "").toLowerCase().includes(term));
      const matchesFilter = selected === "all" || (selected === "paid" ? booking.payment_status === "paid" : booking.payment_status === selected);
      return matchesTerm && matchesFilter;
    });
    if (!visible.length) { list.innerHTML = '<div class="empty-state">No bookings match this view.</div>'; return; }
    list.innerHTML = visible.map(booking => {
      const rooms = booking.rooms.map(room => '<li><span>' + escapeHtml(room.name) + ' × ' + room.quantity + ' <small>(' + room.guests_per_room + ' guests per room)</small></span><strong>' + money(room.line_total) + '</strong></li>').join("");
      const payment = booking.payment_status === "submitted_for_verification" ? "Receipt submitted" : statusLabel(booking.payment_status);
      const verify = booking.payment_status === "submitted_for_verification" && booking.has_receipt
        ? '<button class="verify-button" type="button" data-verify="' + escapeHtml(booking.reference) + '">VERIFY PAYMENT & CONFIRM</button>' : "";
      const receipt = booking.has_receipt
        ? '<button class="receipt-button" type="button" data-receipt="' + escapeHtml(booking.reference) + '">VIEW FULL RECEIPT</button>' : '<span class="no-receipt">No receipt uploaded</span>';
      return '<article class="booking-card"><div class="booking-card-top"><div><p class="booking-reference">' + escapeHtml(booking.reference) + '</p><h3>' + escapeHtml(booking.guest_name) + '</h3></div><span class="status-pill ' + (booking.payment_status === "paid" ? "is-paid" : booking.payment_status === "submitted_for_verification" ? "is-review" : "") + '">' + escapeHtml(payment) + '</span></div>' +
        '<div class="guest-details"><a href="mailto:' + encodeURIComponent(booking.guest_email) + '">' + escapeHtml(booking.guest_email) + '</a><a href="tel:' + encodeURIComponent(booking.guest_phone) + '">' + escapeHtml(booking.guest_phone) + '</a></div>' +
        '<div class="stay-details"><div><span>CHECK-IN</span><strong>' + escapeHtml(booking.check_in) + '</strong></div><div><span>CHECK-OUT</span><strong>' + escapeHtml(booking.check_out) + '</strong></div><div><span>NIGHTS</span><strong>' + booking.nights + '</strong></div></div>' +
        '<ul class="room-lines">' + rooms + '</ul><div class="booking-total"><span>BOOKING TOTAL</span><strong>' + money(booking.estimated_total) + '</strong></div>' +
        '<div class="payment-meta"><span>Payment: <strong>' + escapeHtml(booking.payment_method ? booking.payment_method.toUpperCase() : "Not selected") + '</strong></span><span>Booking: ' + escapeHtml(statusLabel(booking.status)) + '</span></div>' +
        '<div class="booking-actions">' + receipt + verify + '</div></article>';
    }).join("");
  };
  const loadBookings = async () => {
    setAlert("Loading secure booking records…");
    try {
      const data = await requestJson("/api/admin/bookings");
      bookings = data.bookings || [];
      document.getElementById("count-total").textContent = data.counts?.total ?? bookings.length;
      document.getElementById("count-awaiting").textContent = data.counts?.awaiting_payment ?? 0;
      document.getElementById("count-review").textContent = data.counts?.submitted_for_verification ?? 0;
      document.getElementById("count-confirmed").textContent = data.counts?.confirmed ?? 0;
      render();
      setAlert("Signed in as markleslie.corp@gmail.com · Booking data refreshed.", "success");
    } catch (error) {
      setAlert(error.message + (error.message.includes("not configured") ? " Cloudflare Access and private receipt storage still need to be enabled." : ""), "error");
      list.innerHTML = '<div class="empty-state">Booking records are locked until administrator access is configured.</div>';
    }
  };
  const openReceipt = async reference => {
    receiptTitle.textContent = reference;
    receiptContent.innerHTML = "<p>Retrieving private receipt…</p>";
    dialog.showModal();
    try {
      const response = await fetch("/api/admin/receipt?reference=" + encodeURIComponent(reference), { cache: "no-store" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Could not open this receipt.");
      }
      const blob = await response.blob();
      if (activeReceiptUrl) URL.revokeObjectURL(activeReceiptUrl);
      activeReceiptUrl = URL.createObjectURL(blob);
      receiptContent.innerHTML = '<img class="receipt-image" src="' + activeReceiptUrl + '" alt="Payment receipt for ' + escapeHtml(reference) + '"><a class="receipt-open-link" href="' + activeReceiptUrl + '" target="_blank" rel="noopener">OPEN IMAGE IN NEW TAB</a>';
    } catch (error) {
      receiptContent.textContent = error.message;
    }
  };
  list.addEventListener("click", async event => {
    const receiptButton = event.target.closest("[data-receipt]");
    const verifyButton = event.target.closest("[data-verify]");
    if (receiptButton) { await openReceipt(receiptButton.dataset.receipt); return; }
    if (verifyButton) {
      const reference = verifyButton.dataset.verify;
      if (!window.confirm("Confirm that the payment receipt for " + reference + " matches the amount received, then mark the booking as paid and confirmed?")) return;
      verifyButton.disabled = true;
      verifyButton.textContent = "VERIFYING…";
      try {
        await requestJson("/api/admin/verify-payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference }) });
        await loadBookings();
      } catch (error) {
        setAlert(error.message, "error");
        verifyButton.disabled = false;
        verifyButton.textContent = "VERIFY PAYMENT & CONFIRM";
      }
    }
  });
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
  document.getElementById("refresh-bookings").addEventListener("click", loadBookings);
  document.getElementById("close-receipt").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { if (activeReceiptUrl) URL.revokeObjectURL(activeReceiptUrl); activeReceiptUrl = null; receiptContent.innerHTML = ""; });
  loadBookings();
})();