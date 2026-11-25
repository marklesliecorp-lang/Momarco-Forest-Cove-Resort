(() => {
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#primary-nav");
  const year = document.querySelector("#year");

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  if (!menuButton || !navigation) return;

  const closeMenu = () => {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    navigation.classList.remove("is-open");
  };

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
    navigation.classList.toggle("is-open", !isOpen);
  });

  navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) closeMenu();
  });
})();

/* Room booking price calculator */
(() => {
  const bookingForm = document.querySelector("#guest-booking-form");
  if (!bookingForm) return;
  const checkIn = bookingForm.querySelector("#check-in");
  const checkOut = bookingForm.querySelector("#check-out");
  const roomRows = [...bookingForm.querySelectorAll(".booking-room-row")];
  const nightsOutput = bookingForm.querySelector("#booking-nights");
  const roomTotalOutput = bookingForm.querySelector("#booking-room-total");
  const grandTotalOutput = bookingForm.querySelector("#booking-grand-total");
  const selectionOutput = bookingForm.querySelector("#booking-selection");
  const message = bookingForm.querySelector("#booking-message");
  const ngnLine = bookingForm.querySelector("#booking-ngn-line");
  const ngnOutput = bookingForm.querySelector("#booking-ngn-total");
  const rateLine = bookingForm.querySelector("#booking-rate-line");
  const rateOutput = bookingForm.querySelector("#booking-rate-value");
  const payLink = bookingForm.querySelector("#booking-pay-link");
  const submit = bookingForm.querySelector("#booking-review");
  const money = (amount) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(amount);
  const naira = (amount) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(amount);
  const getNights = () => {
    if (!checkIn.value || !checkOut.value) return 0;
    return Math.round((new Date(checkOut.value + "T00:00:00") - new Date(checkIn.value + "T00:00:00")) / 86400000);
  };
  const updateBooking = () => {
    const nights = getNights();
    let total = 0;
    const selected = [];
    roomRows.forEach((row) => {
      const quantity = Number(row.querySelector("[data-quantity]").value) || 0;
      const guestsInput = row.querySelector("[data-guests]");
      const guests = Number(guestsInput.value) || 0;
      const price = Number(row.dataset.price);
      const capacity = Number(row.dataset.capacity);
      guestsInput.disabled = quantity === 0;
      guestsInput.max = String(capacity);
      if (quantity > 0) {
        total += quantity * price * Math.max(nights, 0);
        selected.push(row.dataset.name + " × " + quantity + " (" + guests + " guests per room)");
      }
    });
    nightsOutput.textContent = String(Math.max(nights, 0));
    roomTotalOutput.textContent = money(total);
    grandTotalOutput.textContent = money(total);
    selectionOutput.textContent = selected.length ? selected.join("; ") : "No rooms selected";
    submit.disabled = !(nights > 0 && selected.length > 0);
    message.textContent = checkIn.value && checkOut.value && nights <= 0 ? "Check-out must be later than check-in." : "";
  };
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  checkIn.min = today;
  checkOut.min = today;
  checkIn.addEventListener("change", () => {
    checkOut.min = checkIn.value || today;
    if (checkOut.value && checkOut.value <= checkIn.value) checkOut.value = "";
    updateBooking();
  });
  checkOut.addEventListener("change", updateBooking);
  roomRows.forEach((row) => row.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
    const quantity = Number(row.querySelector("[data-quantity]").value) || 0;
    const guests = row.querySelector("[data-guests]");
    if (quantity > 0 && Number(guests.value) > Number(row.dataset.capacity)) guests.value = row.dataset.capacity;
    updateBooking();
  })));
  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nights = getNights();
    const chosen = roomRows.filter((row) => Number(row.querySelector("[data-quantity]").value) > 0);
    if (nights < 1 || chosen.length === 0) {
      message.textContent = "Choose your dates and at least one room to continue.";
      return;
    }
    const invalid = chosen.some((row) => {
      const quantity = Number(row.querySelector("[data-quantity]").value);
      const guests = Number(row.querySelector("[data-guests]").value);
      return !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(guests) || guests < 1 || guests > Number(row.dataset.capacity);
    });
    if (invalid || !bookingForm.reportValidity()) {
      message.textContent = "Please check the guest count for each selected room.";
      return;
    }
    const rooms = chosen.map((row) => ({
      room_type_id: row.dataset.roomId,
      quantity: Number(row.querySelector("[data-quantity]").value),
      guests_per_room: Number(row.querySelector("[data-guests]").value)
    }));
    const fields = new FormData(bookingForm);
    const payload = {
      full_name: fields.get("full_name"),
      email: fields.get("email"),
      phone: fields.get("phone"),
      check_in: checkIn.value,
      check_out: checkOut.value,
      rooms
    };
    submit.disabled = true;
    submit.textContent = "SUBMITTING REQUEST…";
    message.textContent = "Preparing your booking and secure payment…";
    try {
      const response = await fetch("/api/booking-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We could not submit your request. Please try again.");
      if (!result.payment_url || new URL(result.payment_url).origin !== "https://checkout.paystack.com") throw new Error("The secure Paystack checkout link could not be validated.");
      ngnOutput.textContent = naira(result.ngn_amount);
      rateOutput.textContent = "₱1 = ₦" + Number(result.exchange_rate).toFixed(4) + " · rate date " + result.exchange_rate_date;
      ngnLine.hidden = false;
      rateLine.hidden = false;
      payLink.href = result.payment_url;
      payLink.hidden = false;
      message.textContent = "Booking reference: " + result.reference + ". Your secure Paystack checkout is opening now. Your booking is confirmed only after Paystack verifies payment.";
      message.classList.add("is-success");
      bookingForm.querySelectorAll("input").forEach((input) => { input.disabled = true; });
      submit.textContent = "OPENING SECURE PAYMENT…";
      window.location.assign(result.payment_url);
    } catch (error) {
      message.textContent = error.message || "Something went wrong. Please try again.";
      submit.disabled = false;
      submit.innerHTML = 'CONTINUE TO PAYMENT <span aria-hidden="true">→</span>';
    }
  });
  updateBooking();
})();
