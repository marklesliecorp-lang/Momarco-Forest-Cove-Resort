const json = (data, status = 200) => new Response(JSON.stringify(data), {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const SUPABASE_URL="https://sihtnfghwmsybsqboghp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_6aV0ZkCoFhu7lCUK5KJhHA_I81UBL6m";
export async function onRequestPost({request,env}) {
  const origin=request.headers.get("Origin");
  try { if(origin&&new URL(origin).host!==new URL(request.url).host)return json({error:"Request origin not allowed."},403); }
  catch { return json({error:"Request origin is invalid."},403); }
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
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))return json({error:"Only JPG, PNG and WEBP screenshots are accepted."},415);
  if(!env.DB)return json({error:"Booking database is unavailable."},503);
  try {
    const booking=await env.DB.prepare("SELECT id, payment_status, proof_object_key FROM booking_requests WHERE reference = ? AND guest_email = ?").bind(reference,email).first();
    if(!booking)return json({error:"We could not match this booking reference and email address."},404);
    if(booking.payment_status!=="awaiting_payment"||booking.proof_object_key)return json({error:"This booking is not eligible for another receipt upload."},409);
    const uploadForm=new FormData();
    uploadForm.set("reference",reference);
    uploadForm.set("email",email);
    uploadForm.set("payment_method",method);
    uploadForm.set("payment_proof",file,file.name||"receipt");
    const upload=await fetch(SUPABASE_URL+"/functions/v1/momarco-receipts",{
      method:"POST",
      headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+SUPABASE_PUBLISHABLE_KEY},
      body:uploadForm
    });
    const uploadData=await upload.json().catch(()=>({}));
    if(!upload.ok||!uploadData.ok||!uploadData.objectKey)return json({error:uploadData.error||"We could not securely save your screenshot. Please try again."},upload.status||502);
    const updated=await env.DB.prepare("UPDATE booking_requests SET payment_method = ?, proof_object_key = ?, payment_notice_at = CURRENT_TIMESTAMP, payment_status = 'submitted_for_verification', status = 'awaiting_verification' WHERE id = ? AND payment_status = 'awaiting_payment' AND (proof_object_key IS NULL OR proof_object_key = '')").bind(method,uploadData.objectKey,booking.id).run();
    if(!updated.meta?.changes)return json({error:"This booking has already received a payment update. Please contact the resort if needed."},409);
    return json({ok:true,reference,payment_status:"submitted_for_verification"},200);
  } catch(error) {
    console.error("Payment proof submission failed:",error);
    return json({error:"We could not securely save your screenshot. Please try again."},500);
  }
}