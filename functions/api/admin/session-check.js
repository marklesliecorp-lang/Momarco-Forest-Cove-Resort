import { requireAdmin, adminJson } from "../../_utils/admin-auth.js";
export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
