import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const siteUrl = Deno.env.get('SITE_URL') || 'https://vfb-groetzingen.github.io/Vereinskalender/';
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || 'https://vfb-groetzingen.github.io';
const headers = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const validRole = (role: unknown): role is 'admin' | 'bearbeiter' => role === 'admin' || role === 'bearbeiter';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!jwt) return json({ error: 'Anmeldung erforderlich.' }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser(jwt);
  if (userError || !userData.user) return json({ error: 'Sitzung ungültig oder abgelaufen.' }, 401);

  const { data: membership, error: membershipError } = await adminClient
    .from('memberships').select('role').eq('user_id', userData.user.id).maybeSingle();
  if (membershipError || membership?.role !== 'admin') return json({ error: 'Nur Administratoren dürfen diese Aktion ausführen.' }, 403);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ error: 'Ungültiger JSON-Inhalt.' }, 400); }
  const action = input.action;

  if (action === 'list') {
    const [{ data: userPage, error: usersError }, { data: memberships, error: membersError }] = await Promise.all([
      adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      adminClient.from('memberships').select('user_id, role, created_at')
    ]);
    if (usersError || membersError) return json({ error: 'Benutzerliste konnte nicht geladen werden.' }, 500);
    const roles = new Map((memberships || []).map((m) => [m.user_id, m]));
    const users = (userPage?.users || []).filter((u) => roles.has(u.id)).map((u) => ({
      id: u.id,
      email: u.email || null,
      email_confirmed_at: u.email_confirmed_at || null,
      invited_at: u.invited_at || null,
      role: roles.get(u.id)?.role || null,
      created_at: u.created_at
    }));
    return json({ users });
  }

  if (action === 'invite') {
    const email = String(input.email || '').trim().toLowerCase();
    const role = input.role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
    if (!validRole(role)) return json({ error: 'Ungültige Rolle.' }, 400);
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo: siteUrl });
    if (error || !data.user) return json({ error: error?.message || 'Einladung konnte nicht erstellt werden.' }, 400);
    const { error: roleError } = await adminClient.from('memberships').upsert({ user_id: data.user.id, role }, { onConflict: 'user_id' });
    if (roleError) {
      await adminClient.auth.admin.deleteUser(data.user.id);
      return json({ error: 'Benutzerkonto wurde nicht vollständig eingerichtet. Bitte Einladung erneut senden.' }, 500);
    }
    return json({ ok: true });
  }

  const userId = String(input.userId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return json({ error: 'Ungültige Benutzer-ID.' }, 400);
  }
  const { data: target, error: targetError } = await adminClient.from('memberships').select('role').eq('user_id', userId).maybeSingle();
  if (targetError || !target) return json({ error: 'Mitglied wurde nicht gefunden.' }, 404);
  const { count: adminCount, error: countError } = await adminClient.from('memberships').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
  if (countError) return json({ error: 'Admin-Rollen konnten nicht geprüft werden.' }, 500);

  if (action === 'set_role') {
    const role = input.role;
    if (!validRole(role)) return json({ error: 'Ungültige Rolle.' }, 400);
    if (target.role === 'admin' && role !== 'admin' && (adminCount || 0) <= 1) return json({ error: 'Der letzte Administrator kann nicht herabgestuft werden.' }, 409);
    const { error } = await adminClient.from('memberships').update({ role }).eq('user_id', userId);
    if (error) return json({ error: 'Rolle konnte nicht gespeichert werden.' }, 500);
    return json({ ok: true });
  }

  if (action === 'remove') {
    if (target.role === 'admin' && (adminCount || 0) <= 1) return json({ error: 'Der letzte Administrator kann nicht entfernt werden.' }, 409);
    const { error } = await adminClient.from('memberships').delete().eq('user_id', userId);
    if (error) return json({ error: 'Zugang konnte nicht entzogen werden.' }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Unbekannte Aktion.' }, 400);
});
