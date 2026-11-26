(() => {
  "use strict";
  const list = document.getElementById("booking-list");
  const alertBox = document.getElementById("admin-alert");
  const search = document.getElementById("booking-search");
  const dialog = document.getElementById("receipt-dialog");
  const receiptContent = document.getElementById("receipt-content");
  const receiptTitle = document.getElementById("receipt-title");
  let receipts = [];
  let activeReceiptUrl = null;
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const setAlert = (message, type = "") => { alertBox.textContent = message; alertBox.className = "admin-alert" + (type ? " " + type : ""); };
  const requestJson = async url => {
    const response = await fetch(url, { cache: "no-store", headers: { "Accept": "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  };
  const render = () => {
    const term = search.value.trim().toLowerCase();
    const visible = receipts.filter(item => [item.reference, item.guest_name, item.guest_email].some(value => String(value || "").toLowerCase().includes(term)));
    if (!visible.length) {
      list.innerHTML = '<div class="empty-state">' + (receipts.length ? 'No receipts match your search.' : 'No payment receipts have been submitted yet.') + '</div>';
      return;
    }
    list.innerHTML = visible.map(item =>
      '<article class="booking-card receipt-card"><div class="booking-card-top"><div><p class="booking-reference">' + escapeHtml(item.reference) + '</p><h3>' + escapeHtml(item.guest_name) + '</h3></div><span class="status-pill is-review">RECEIPT UPLOADED</span></div>' +
      '<div class="guest-details"><span>' + escapeHtml(item.guest_email) + '</span><span>Submitted: ' + escapeHtml(item.payment_notice_at || item.created_at || 'Date unavailable') + '</span></div>' +
      '<div class="booking-actions"><button class="receipt-button" type="button" data-receipt="' + escapeHtml(item.reference) + '">VIEW RECEIPT</button></div></article>'
    ).join("");
  };
  const loadReceipts = async () => {
    setAlert("Loading private receipts…");
    try {
      const data = await requestJson("/api/admin/bookings");
      receipts = data.receipts || [];
      render();
      setAlert("Secure access active · " + receipts.length + " receipt" + (receipts.length === 1 ? "" : "s") + " available.", "success");
    } catch (error) {
      setAlert(error.message, "error");
      list.innerHTML = '<div class="empty-state">Receipts are locked until administrator access and private storage are configured.</div>';
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
      const image = document.createElement("img");
      image.className = "receipt-image";
      image.alt = "Payment receipt for " + reference;
      image.src = activeReceiptUrl;
      receiptContent.replaceChildren(image);
    } catch (error) {
      receiptContent.textContent = error.message;
    }
  };
  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-receipt]");
    if (button) await openReceipt(button.dataset.receipt);
  });
  search.addEventListener("input", render);
  document.getElementById("refresh-bookings").addEventListener("click", loadReceipts);
  document.getElementById("close-receipt").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { if (activeReceiptUrl) URL.revokeObjectURL(activeReceiptUrl); activeReceiptUrl = null; receiptContent.innerHTML = ""; });
  loadReceipts();
})();