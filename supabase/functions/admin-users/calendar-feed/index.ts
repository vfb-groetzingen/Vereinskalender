const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function escapeIcs(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function utcStamp(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 73) {
      chunks.push(current);
      current = ` ${char}`;
      bytes = 1 + size;
    } else {
      current += char;
      bytes += size;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

function response(body: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
      "Content-Disposition": 'inline; filename="vfb-kalender.ics"',
      "Cache-Control": "public, max-age=300",
      ...extra,
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return response("Nur GET ist erlaubt.\r\n", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return response("Feed ist nicht konfiguriert.\r\n", 500);

  const url = new URL(request.url);
  const requestedResource = url.searchParams.get("resource_id");
  if (requestedResource && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedResource)) {
    return response("Ungültige resource_id.\r\n", 400);
  }

  const headers = { apikey: anonKey, Accept: "application/json" };
  const resourceUrl = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/resources`);
  resourceUrl.searchParams.set("select", "id,name,is_active");
  resourceUrl.searchParams.set("is_active", "eq.true");
  const resourcesResponse = await fetch(resourceUrl, { headers });
  if (!resourcesResponse.ok) return response("Ressourcen konnten nicht geladen werden.\r\n", 502);
  const resources = await resourcesResponse.json();
  const activeResources = new Map((resources as { id: string; name: string }[]).map((item) => [item.id, item.name]));
  if (requestedResource && !activeResources.has(requestedResource)) return response("Kalender nicht gefunden.\r\n", 404);

  const bookingsUrl = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/public_bookings`);
  bookingsUrl.searchParams.set("select", "id,resource_id,title,starts_at,ends_at");
  bookingsUrl.searchParams.set("starts_at", `gte.${new Date(Date.now() - 30 * 86400000).toISOString()}`);
  bookingsUrl.searchParams.set("order", "starts_at.asc");
  bookingsUrl.searchParams.set("limit", "5000");
  if (requestedResource) bookingsUrl.searchParams.set("resource_id", `eq.${requestedResource}`);
  const bookingsResponse = await fetch(bookingsUrl, { headers });
  if (!bookingsResponse.ok) return response("Belegungen konnten nicht geladen werden.\r\n", 502);
  const rows = await bookingsResponse.json() as { id: string; resource_id: string; title: string; starts_at: string; ends_at: string }[];

  const grouped = new Map<string, { id: string; title: string; starts_at: string; ends_at: string; names: Set<string> }>();
  for (const row of rows) {
    const name = activeResources.get(row.resource_id);
    if (!name) continue;
    const item = grouped.get(row.id) || { id: row.id, title: row.title, starts_at: row.starts_at, ends_at: row.ends_at, names: new Set<string>() };
    item.names.add(name);
    grouped.set(row.id, item);
  }

  const now = utcStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VfB Groetzingen//Vereinskalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:VfB Grötzingen – Belegungsplan",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const item of grouped.values()) {
    const location = [...item.names].sort((a, b) => a.localeCompare(b, "de")).join(", ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.id}@vfb-groetzingen.de`,
      `DTSTAMP:${now}`,
      `DTSTART:${utcStamp(item.starts_at)}`,
      `DTEND:${utcStamp(item.ends_at)}`,
      `SUMMARY:${escapeIcs(item.title)}`,
      `LOCATION:${escapeIcs(location)}`,
      "DESCRIPTION:Buchung im öffentlichen Vereinskalender.",
      "STATUS:CONFIRMED",
      "CLASS:PUBLIC",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  const body = lines.map(foldLine).join("\r\n") + "\r\n";
  return response(body, 200, { "ETag": `W/"${btoa(String(rows.length) + now).slice(0, 24)}"` });
});
