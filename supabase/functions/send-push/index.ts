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
    const { data, error } = await supabase.from("asc_push_devices")
      .select("device_id,athlete_id,parent_id,coach_id,role,platform,fcm_token,last_seen")
      .not("fcm_token", "is", null);
    if (error) throw error;
    const devices = Array.isArray(data) ? data : [];
    let targetAthleteId = athleteId;
    let targetCoachId = coachId;
    if (athleteId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(athleteId)) {
      const { data: athlete, error: athleteError } = await supabase.from("asc_athletes").select("id").eq("legacy_id", athleteId).maybeSingle();
      if (athleteError) throw athleteError;
      targetAthleteId = String(athlete?.id || "");
    }
    if (coachId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(coachId)) {
      const { data: coach, error: coachError } = await supabase.from("asc_coaches").select("id").eq("legacy_id", coachId).maybeSingle();
      if (coachError) throw coachError;
      targetCoachId = String(coach?.id || "");
    }
    const filtered = devices.filter((d: Record<string, string>) => {
      if (!d?.fcm_token) return false;
      if (target === "all") return true;
      if (target === "admin") return d.role === "admin";
      if (target === "parent") return d.role === "parent" && (!athleteId || d.athlete_id === targetAthleteId || d.parent_id === targetAthleteId);
      if (target === "coach") return d.role === "coach" && (!coachId || d.coach_id === targetCoachId);
      return false;
    });
    const uniqueDevices = [...new Map(filtered.map((d: Record<string, string>) => [d.fcm_token, d])).values()];
    if (!uniqueDevices.length) return new Response(JSON.stringify({ ok: true, sent: 0, message: "Belum ada perangkat tujuan yang terdaftar." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const accessToken = await getAccessToken(projectId, clientEmail, privateKey);
    const results = await Promise.all(uniqueDevices.map(async (device: Record<string, string>) => {
      const token = device.fcm_token;
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token, notification: { title, body: message }, data: { title, message, page, eventId }, android: { priority: "high", notification: { channel_id: "aqilah_notifications" } } } }),
      });
      const detail = response.ok ? await response.json() : await response.text();
      if (!response.ok && /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/i.test(String(detail))) {
        const { error: deactivateError } = await supabase.from("asc_push_devices").update({ fcm_token: null, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("device_id", device.device_id);
        if (deactivateError) console.error("Token FCM invalid gagal dinonaktifkan:", deactivateError);
      }
      return { deviceId: device.device_id, token: String(token).slice(0, 12), ok: response.ok, detail };
    }));
    return new Response(JSON.stringify({ ok: true, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
