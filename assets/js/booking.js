(() => {
  "use strict";
  const form = document.getElementById("guest-booking-form");
  if (!form) return;
  const checkIn = document.getElementById("check-in");
  const checkOut = document.getElementById("check-out");
  const button = document.getElementById("booking-review");
  const message = document.getElementById("booking-message");
  const roomRows = Array.from(form.querySelectorAll(".booking-room-row"));
  const paymentPanel = document.getElementById("payment-panel");
  const paymentMessage = document.getElementById("payment-message");
  const paymentProof = document.getElementById("payment-proof");
  const paymentSubmit = document.getElementById("payment-submit");
  const proofArea = document.getElementById("payment-proof-area");
  const accounts = {
    gcash: document.getElementById("gcash-account"),
    cimb: document.getElementById("cimb-account")
  };
  const outputs = {
    selection: document.getElementById("booking-selection"),
    nights: document.getElementById("booking-nights"),
    roomTotal: document.getElementById("booking-room-total"),
    grandTotal: document.getElementById("booking-grand-total")
  };
  if (!checkIn || !checkOut || !button || !message || !roomRows.length ||
      !paymentPanel || !paymentSubmit || !paymentProof) {
    console.error("Booking form setup is incomplete.");
    return;
  }
  let sending = false;
  let submittingProof = false;
  let bookingReference = "";
  const php = new Intl.NumberFormat("en-PH", {style:"currency",currency:"PHP",maximumFractionDigits:0});
  const localDate = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  };
  const nightsCount = () => {
    if (!checkIn.value || !checkOut.value) return 0;
    return Math.round((Date.parse(checkOut.value+"T00:00:00Z")-Date.parse(checkIn.value+"T00:00:00Z"))/86400000);
  };
  const chosenRooms = () => roomRows.map(row => {
    const quantityInput=row.querySelector("[data-quantity]");
    const guestsInput=row.querySelector("[data-guests]");
    return {row,id:row.dataset.roomId,quantity:Number(quantityInput.value),guests:Number(guestsInput.value),capacity:Number(row.dataset.capacity),price:Number(row.dataset.price)};
  }).filter(room=>room.quantity>0);
  const showMessage=(text,success=false)=>{message.textContent=text;message.classList.toggle("is-success",success);};
  const refresh=()=>{
    const nights=nightsCount(), selected=chosenRooms();
    const total=selected.reduce((sum,room)=>sum+room.quantity*room.price*Math.max(nights,0),0);
    roomRows.forEach(row=>{
      const quantity=Number(row.querySelector("[data-quantity]").value)||0;
      const guests=row.querySelector("[data-guests]");
      guests.disabled=quantity<1; guests.max=row.dataset.capacity;
    });
    outputs.nights.textContent=String(Math.max(nights,0));
    outputs.roomTotal.textContent=php.format(total);
    outputs.grandTotal.textContent=php.format(total);
    outputs.selection.textContent=selected.length?selected.map(room=>room.row.dataset.name+" × "+room.quantity+" ("+room.guests+" guests per room)").join("; "):"No rooms selected";
    button.disabled=sending||!(nights>0&&selected.length>0);
    if(checkIn.value&&checkOut.value&&nights<1) showMessage("Check-out must be later than check-in.");
    else if(!sending) showMessage("");
  };
  const focusInvalidField=()=>{
    const fields=Array.from(form.querySelectorAll("input"));
    const invalid=fields.find(field=>!field.disabled&&!field.closest("#payment-panel")&&!field.checkValidity());
    if(invalid){invalid.focus();if(typeof invalid.reportValidity==="function")invalid.reportValidity();return true;}
    return false;
  };
  const startPayment=async()=>{
    if(sending||bookingReference)return;
    const nights=nightsCount(),selected=chosenRooms();
    if(!checkIn.value||!checkOut.value||nights<1){showMessage("Please choose a valid check-in and check-out date.");(nights<1&&checkIn.value&&checkOut.value?checkOut:checkIn).focus();return;}
    if(!selected.length){showMessage("Please select at least one room.");roomRows[0].querySelector("[data-quantity]").focus();return;}
    const badRoom=selected.find(room=>!Number.isSafeInteger(room.quantity)||room.quantity<1||!Number.isSafeInteger(room.guests)||room.guests<1||room.guests>room.capacity);
    if(badRoom){showMessage("Please check the room quantity and guests per room for "+badRoom.row.dataset.name+".");badRoom.row.querySelector("[data-guests]").focus();return;}
    if(focusInvalidField()){showMessage("Please complete your name, email address and phone number.");return;}
    const payload={
      full_name:form.elements.full_name.value.trim(),email:form.elements.email.value.trim(),
      phone:form.elements.phone.value.trim(),check_in:checkIn.value,check_out:checkOut.value,
      rooms:selected.map(room=>({room_type_id:room.id,quantity:room.quantity,guests_per_room:room.guests}))
    };
    sending=true;button.disabled=true;button.textContent="SAVING YOUR BOOKING…";
    showMessage("Saving your booking details…");
    try{
      const response=await fetch("/api/booking-requests",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload),cache:"no-store"});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.reference)throw new Error(result?.error||"We could not save your booking. Please try again.");
      bookingReference=result.reference;
      button.textContent="BOOKING SAVED";
      button.disabled=true;
      paymentPanel.hidden=false;
      paymentMessage.textContent="Booking reference: "+bookingReference+". Select GCash or CIMB Bank to view the transfer details.";
      showMessage("Booking request saved. Complete the manual payment steps below.",true);
      form.querySelectorAll("input,button").forEach(field=>{if(!field.closest("#payment-panel"))field.disabled=true;});
      paymentPanel.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){
      console.error("Booking submission failed:",error);
      sending=false;button.disabled=false;button.textContent="CONTINUE TO PAYMENT →";
      showMessage(error?.message||"Something went wrong. Please try again.");
    }
  };
  const selectedMethod=()=>form.querySelector('input[name="payment_method"]:checked')?.value||"";
  form.querySelectorAll('input[name="payment_method"]').forEach(input=>input.addEventListener("change",()=>{
    const method=selectedMethod();
    Object.entries(accounts).forEach(([key,element])=>{element.hidden=key!==method;});
    proofArea.hidden=!method;
    paymentMessage.textContent=method?"Transfer the exact PHP total shown above, then upload your payment screenshot.":"";
  }));
  paymentSubmit.addEventListener("click",async()=>{
    if(submittingProof)return;
    const method=selectedMethod();
    if(!bookingReference){paymentMessage.textContent="Your booking reference is missing. Please restart the booking.";return;}
    if(!method){paymentMessage.textContent="Please choose GCash or CIMB Bank.";return;}
    const file=paymentProof.files?.[0];
    if(!file){paymentMessage.textContent="Please upload your payment screenshot.";paymentProof.focus();return;}
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024){paymentMessage.textContent="Choose a JPG, PNG or WEBP image no larger than 5 MB.";return;}
    const data=new FormData();
    data.append("reference",bookingReference);
    data.append("email",form.elements.email.value.trim());
    data.append("payment_method",method);
    data.append("payment_proof",file,file.name);
    submittingProof=true;paymentSubmit.disabled=true;paymentSubmit.textContent="UPLOADING PROOF…";
    paymentMessage.textContent="Uploading your payment screenshot securely…";
    try{
      const response=await fetch("/api/booking-payment-proof",{method:"POST",body:data,cache:"no-store"});
      const result=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(result?.error||"We could not submit your payment proof. Please try again.");
      proofArea.hidden=true;
      paymentPanel.querySelector(".booking-payment-methods").hidden=true;
      Object.values(accounts).forEach(element=>element.hidden=true);
      paymentMessage.textContent="Payment notice and screenshot received for booking "+bookingReference+". Your booking will be confirmed once the resort verifies your payment.";
      paymentMessage.classList.add("is-success");
      paymentSubmit.hidden=true;
    }catch(error){
      console.error("Payment proof submission failed:",error);
      paymentMessage.textContent=error?.message||"Payment proof upload failed. Please try again.";
      submittingProof=false;paymentSubmit.disabled=false;paymentSubmit.textContent="I HAVE PAID";
    }
  });
  const today=localDate();checkIn.min=today;checkOut.min=today;
  checkIn.addEventListener("change",()=>{checkOut.min=checkIn.value||today;if(checkOut.value&&checkOut.value<=checkIn.value)checkOut.value="";refresh();});
  checkOut.addEventListener("change",refresh);
  roomRows.forEach(row=>row.querySelectorAll("input").forEach(input=>input.addEventListener("input",()=>{
    const quantity=Number(row.querySelector("[data-quantity]").value)||0;
    const guests=row.querySelector("[data-guests]"),capacity=Number(row.dataset.capacity);
    if(quantity>0&&Number(guests.value)>capacity)guests.value=String(capacity);
    refresh();
  })));
  button.addEventListener("click",startPayment);
  refresh();
})();