(() => {
  "use strict";

  const form = document.getElementById("guest-booking-form");
  if (!form) return;

  const checkIn = document.getElementById("check-in");
  const checkOut = document.getElementById("check-out");
  const button = document.getElementById("booking-review");
  const message = document.getElementById("booking-message");
  const roomRows = Array.from(form.querySelectorAll(".booking-room-row"));
  const payLink = document.getElementById("booking-pay-link");

  const outputs = {
    selection: document.getElementById("booking-selection"),
    nights: document.getElementById("booking-nights"),
    roomTotal: document.getElementById("booking-room-total"),
    grandTotal: document.getElementById("booking-grand-total"),
    ngnLine: document.getElementById("booking-ngn-line"),
    ngnTotal: document.getElementById("booking-ngn-total"),
    rateLine: document.getElementById("booking-rate-line"),
    rateValue: document.getElementById("booking-rate-value")
  };

  if (!checkIn || !checkOut || !button || !message || !roomRows.length) {
    console.error("Booking form setup is incomplete.");
    return;
  }

  let sending = false;
  const php = new Intl.NumberFormat("en-PH", {
    style: "currency", currency: "PHP", maximumFractionDigits: 0
  });
  const ngn = new Intl.NumberFormat("en-NG", {
    style: "currency", currency: "NGN", maximumFractionDigits: 2
  });

  const localDate = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
  };

  const nightsCount = () => {
    if (!checkIn.value || !checkOut.value) return 0;
    return Math.round(
      (Date.parse(checkOut.value + "T00:00:00Z") -
       Date.parse(checkIn.value + "T00:00:00Z")) / 86400000
    );
  };

  const chosenRooms = () => roomRows.map((row) => {
    const quantityInput = row.querySelector("[data-quantity]");
    const guestsInput = row.querySelector("[data-guests]");
    return {
      row,
      id: row.dataset.roomId,
      quantity: Number(quantityInput.value),
      guests: Number(guestsInput.value),
      capacity: Number(row.dataset.capacity),
      price: Number(row.dataset.price)
    };
  }).filter((room) => room.quantity > 0);

  const showMessage = (text, success = false) => {
    message.textContent = text;
    message.classList.toggle("is-success", success);
  };

  const refresh = () => {
    const nights = nightsCount();
    const selected = chosenRooms();
    const total = selected.reduce(
      (sum, room) => sum + room.quantity * room.price * Math.max(nights, 0), 0
    );

    roomRows.forEach((row) => {
      const quantity = Number(row.querySelector("[data-quantity]").value) || 0;
      const guests = row.querySelector("[data-guests]");
      guests.disabled = quantity < 1;
      guests.max = row.dataset.capacity;
    });

    outputs.nights.textContent = String(Math.max(nights, 0));
    outputs.roomTotal.textContent = php.format(total);
    outputs.grandTotal.textContent = php.format(total);
    outputs.selection.textContent = selected.length
      ? selected.map((room) => room.row.dataset.name + " × " + room.quantity +
          " (" + room.guests + " guests per room)").join("; ")
      : "No rooms selected";

    button.disabled = sending || !(nights > 0 && selected.length > 0);
    if (checkIn.value && checkOut.value && nights < 1) {
      showMessage("Check-out must be later than check-in.");
    } else if (!sending) {
      showMessage("");
    }
  };

  const focusInvalidField = () => {
    const fields = Array.from(form.querySelectorAll("input"));
    const invalid = fields.find((field) =>
      !field.disabled && !field.checkValidity()
    );
    if (invalid) {
      invalid.focus();
      if (typeof invalid.reportValidity === "function") invalid.reportValidity();
      return true;
    }
    return false;
  };

  const startPayment = async () => {
    if (sending) return;

    const nights = nightsCount();
    const selected = chosenRooms();

    if (!checkIn.value || !checkOut.value || nights < 1) {
      showMessage("Please choose a valid check-in and check-out date.");
      (nights < 1 && checkIn.value && checkOut.value ? checkOut : checkIn).focus();
      return;
    }
    if (!selected.length) {
      showMessage("Please select at least one room.");
      roomRows[0].querySelector("[data-quantity]").focus();
      return;
    }

    const badRoom = selected.find((room) =>
      !Number.isSafeInteger(room.quantity) || room.quantity < 1 ||
      !Number.isSafeInteger(room.guests) || room.guests < 1 ||
      room.guests > room.capacity
    );
    if (badRoom) {
      showMessage("Please check the room quantity and guests per room for " +
        badRoom.row.dataset.name + ".");
      badRoom.row.querySelector("[data-guests]").focus();
      return;
    }

    if (focusInvalidField()) {
      showMessage("Please complete your name, email address and phone number.");
      return;
    }

    const payload = {
      full_name: form.elements.full_name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      check_in: checkIn.value,
      check_out: checkOut.value,
      rooms: selected.map((room) => ({
        room_type_id: room.id,
        quantity: room.quantity,
        guests_per_room: room.guests
      }))
    };

    sending = true;
    button.disabled = true;
    button.textContent = "PREPARING SECURE PAYMENT…";
    showMessage("Submitting your booking and preparing Paystack checkout…");

    try {
      const response = await fetch("/api/booking-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store"
      });

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The booking service returned an unreadable response. Please try again.");
      }
      if (!response.ok) {
        throw new Error(result.error || "We could not prepare your booking. Please try again.");
      }

      const paymentUrl = new URL(result.payment_url);
      if (paymentUrl.protocol !== "https:" ||
          paymentUrl.hostname !== "checkout.paystack.com") {
        throw new Error("Paystack did not return a valid secure checkout address.");
      }

      outputs.ngnTotal.textContent = ngn.format(Number(result.ngn_amount));
      outputs.rateValue.textContent = "₱1 = ₦" +
        Number(result.exchange_rate).toFixed(4) +
        " · rate date " + result.exchange_rate_date;
      outputs.ngnLine.hidden = false;
      outputs.rateLine.hidden = false;

      showMessage("Booking reference: " + result.reference +
        ". Redirecting you to Paystack secure checkout. Your booking is confirmed after payment is verified.", true);

      if (payLink) {
        payLink.href = paymentUrl.href;
        payLink.hidden = false;
      }

      window.location.href = paymentUrl.href;
    } catch (error) {
      console.error("Booking submission failed:", error);
      sending = false;
      button.disabled = false;
      button.textContent = "CONTINUE TO PAYMENT →";
      showMessage(error && error.message
        ? error.message
        : "Something went wrong. Please try again.");
    }
  };

  const today = localDate();
  checkIn.min = today;
  checkOut.min = today;

  checkIn.addEventListener("change", () => {
    checkOut.min = checkIn.value || today;
    if (checkOut.value && checkOut.value <= checkIn.value) checkOut.value = "";
    refresh();
  });
  checkOut.addEventListener("change", refresh);
  roomRows.forEach((row) => {
    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        const quantity = Number(row.querySelector("[data-quantity]").value) || 0;
        const guests = row.querySelector("[data-guests]");
        const capacity = Number(row.dataset.capacity);
        if (quantity > 0 && Number(guests.value) > capacity) {
          guests.value = String(capacity);
        }
        refresh();
      });
    });
  });

  button.addEventListener("click", startPayment);
  refresh();
})();