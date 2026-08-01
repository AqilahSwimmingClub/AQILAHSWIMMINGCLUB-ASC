import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();
function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function pemToArrayBuffer(pem: string) {
  const clean = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function getAccessToken(projectId: string, clientEmail: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const jwt = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!response.ok) throw new Error(`OAuth Firebase gagal: ${await response.text()}`);
  return (await response.json()).access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const clubId = String(body.clubId || "aqilah-swimming-club");
    const target = String(body.target || "all");
    const athleteId = String(body.athleteId || "");
    const coachId = String(body.coachId || "");
    const title = String(body.title || "AQILAH Swimming Club");
    const message = String(body.message || "Ada informasi baru.");
    const page = String(body.page || "dashboard");
    const eventId = String(body.eventId || "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID")!;
    const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL")!;
    const privateKey = Deno.env.get("FIREBASE_PRIVATE_KEY")!;
    if (!supabaseUrl || !serviceRole || !projectId || !clientEmail || !privateKey) throw new Error("Secret Supabase/Firebase belum lengkap.");

    const supabase = createClient(supabaseUrl, serviceRole);
    const { data, error } = await supabase.from("class_app_data").select("payload").eq("class_id", clubId).maybeSingle();
    if (error) throw error;
    const devices = Array.isArray(data?.payload?.pushDevices) ? data.payload.pushDevices : [];
    const filtered = devices.filter((d: Record<string, string>) => {
      if (!d?.token) return false;
      if (target === "all") return true;
      if (target === "admin") return d.role === "admin";
      if (target === "parent") return d.role === "parent" && (!athleteId || d.athleteId === athleteId);
      if (target === "coach") return d.role === "coach" && (!coachId || d.coachId === coachId);
      return false;
    });
    const tokens = [...new Set(filtered.map((d: Record<string, string>) => d.token))];
    if (!tokens.length) return new Response(JSON.stringify({ ok: true, sent: 0, message: "Belum ada perangkat tujuan yang terdaftar." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const accessToken = await getAccessToken(projectId, clientEmail, privateKey);
    const results = await Promise.all(tokens.map(async (token) => {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token, notification: { title, body: message }, data: { title, message, page, eventId }, android: { priority: "high", notification: { channel_id: "aqilah_notifications" } } } }),
      });
      return { token: String(token).slice(0, 12), ok: response.ok, detail: response.ok ? await response.json() : await response.text() };
    }));
    return new Response(JSON.stringify({ ok: true, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
