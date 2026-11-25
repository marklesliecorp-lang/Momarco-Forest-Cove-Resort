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
  const submit = bookingForm.querySelector("#booking-review");
  const money = (amount) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(amount);
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
  bookingForm.addEventListener("submit", (event) => {
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
      return quantity < 1 || guests < 1 || guests > Number(row.dataset.capacity);
    });
    if (invalid || !bookingForm.reportValidity()) {
      message.textContent = "Please check the guest count for each selected room.";
      return;
    }
    message.textContent = "Your booking details are ready to review. Online payment and reservation confirmation will be activated after the secure booking system is connected. No payment has been taken and no room is reserved yet.";
  });
  updateBooking();
})();
