const json = (data, status = 200) => new Response(JSON.stringify(data), {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestPost({request,env}) {
  const origin=request.headers.get("Origin");
  try { if(origin&&new URL(origin).host!==new URL(request.url).host)return json({error:"Request origin not allowed."},403); }
  catch { return json({error:"Request origin is invalid."},403); }
  if(!env.PROOF_BUCKET)return json({error:"Secure screenshot storage is not enabled yet. Your booking is saved, but proof upload is temporarily unavailable. Please contact the resort to arrange payment proof submission."},503);
  const length=Number(request.headers.get("content-length")||0);
  if(length>5*1024*1024+12000)return json({error:"The screenshot must be no larger than 5 MB."},413);
  let form;
  try { form=await request.formData(); } catch { return json({error:"Please submit the payment screenshot again."},400); }
  const reference=String(form.get("reference")||"").trim();
  const email=String(form.get("email")||"").trim().toLowerCase();
  const method=String(form.get("payment_method")||"").trim();
  const file=form.get("payment_proof");
  if(!/^MFC-[A-Z0-9-]{8,60}$/.test(reference)||!email||!["gcash","cimb"].includes(method))return json({error:"Booking or payment details are invalid."},400);
  if(!(file instanceof File)||file.size<1||file.size>5*1024*1024)return json({error:"Choose a payment screenshot up to 5 MB."},400);
  const types={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  const extension=types[file.type];
  if(!extension)return json({error:"Only JPG, PNG and WEBP screenshots are accepted."},415);
  const booking=await env.DB.prepare("SELECT id, payment_status FROM booking_requests WHERE reference = ? AND guest_email = ?").bind(reference,email).first();
  if(!booking)return json({error:"We could not match this booking reference and email address."},404);
  if(booking.payment_status==="submitted_for_verification")return json({error:"Payment proof has already been submitted for this booking."},409);
  const objectKey="payment-proofs/"+reference+"/"+crypto.randomUUID()+"."+extension;
  try {
    await env.PROOF_BUCKET.put(objectKey,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{bookingReference:reference,paymentMethod:method}});
    const updated=await env.DB.prepare("UPDATE booking_requests SET payment_method = ?, proof_object_key = ?, payment_notice_at = CURRENT_TIMESTAMP, payment_status = 'submitted_for_verification', status = 'awaiting_verification' WHERE id = ? AND payment_status = 'awaiting_payment'").bind(method,objectKey,booking.id).run();
    if(!updated.meta?.changes) { await env.PROOF_BUCKET.delete(objectKey); return json({error:"This booking has already received a payment update."},409); }
  } catch {
    try { await env.PROOF_BUCKET.delete(objectKey); } catch {}
    return json({error:"We could not securely save your screenshot. Please try again."},500);
  }
  return json({ok:true,reference,payment_status:"submitted_for_verification"},200);
}