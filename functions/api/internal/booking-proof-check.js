const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestGet({request,env}) {
  if(!env.DB) return json({error:"Booking database is unavailable."},503);
  const url=new URL(request.url);
  const reference=(url.searchParams.get("reference")||"").trim();
  const email=(url.searchParams.get("email")||"").trim().toLowerCase();
  if(!/^MFC-[A-Z0-9-]{8,60}$/.test(reference)||!email||email.length>254) return json({error:"Booking details are invalid."},400);
  try {
    const booking=await env.DB.prepare("SELECT payment_status, proof_object_key FROM booking_requests WHERE reference = ? AND guest_email = ?").bind(reference,email).first();
    if(!booking) return json({error:"We could not match this booking reference and email address."},404);
    if(booking.payment_status!=="awaiting_payment"||booking.proof_object_key) return json({error:"This booking is not eligible for another receipt upload."},409);
    return json({ok:true});
  } catch(error) {
    console.error("Receipt eligibility check failed:",error);
    return json({error:"Could not validate this booking."},500);
  }
}