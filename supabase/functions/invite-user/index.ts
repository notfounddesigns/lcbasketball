// Invite a coach, admin or player by email. Browsers can't create logins
// (that needs the service-role key, and public sign-up is off), so the app
// calls this function instead. It checks the caller's role first:
//   admin → may invite any role
//   coach → may invite player logins, for players they can edit
//
// Deploy:  supabase functions deploy invite-user
// It uses the project's built-in SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY secrets; nothing else to configure.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Role = 'admin' | 'coach' | 'player'

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })
  try {
    return await handle(req)
  } catch (e) {
    // Always answer JSON so the app can show what went wrong.
    console.error(e)
    return reply(500, { error: `Invite failed: ${e instanceof Error ? e.message : String(e)}` })
  }
})

async function handle(req: Request) {

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Who's asking: run their own checks with their own token (RLS applies).
  const asCaller = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: me } = await asCaller.auth.getUser()
  if (!me.user) return reply(401, { error: 'Sign in first.' })
  const { data: callerRole } = await asCaller.rpc('my_role')

  let body: { email?: string; role?: Role; display_name?: string; player_id?: string; redirect_to?: string }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Bad request.' })
  }
  const email = body.email?.trim().toLowerCase() ?? ''
  const role = body.role ?? 'player'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' })
  if (!['admin', 'coach', 'player'].includes(role)) return reply(400, { error: 'Unknown role.' })

  if (callerRole !== 'admin') {
    if (callerRole !== 'coach' || role !== 'player') {
      return reply(403, { error: 'Only an admin can invite coaches and admins.' })
    }
    if (!body.player_id) return reply(400, { error: 'Pick the roster player this login is for.' })
    const { data: ok } = await asCaller.rpc('can_edit_player_id', { pid: body.player_id })
    if (!ok) return reply(403, { error: "You can only invite players on your teams." })
  }

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role, display_name: body.display_name?.trim() || null },
    redirectTo: body.redirect_to,
  })
  if (error || !invited.user) {
    const msg = /already.*registered|exists/i.test(error?.message ?? '')
      ? 'That email already has a login.'
      : error?.message ?? 'Could not send the invite.'
    return reply(400, { error: msg })
  }

  // The new-user trigger creates the profile; make sure role and name stick
  // even if the trigger ran before metadata was set.
  await admin.from('profiles').upsert({
    id: invited.user.id,
    email,
    role,
    display_name: body.display_name?.trim() || null,
  })
  if (body.player_id) {
    await admin.from('players').update({ user_id: invited.user.id }).eq('id', body.player_id)
  }

  return reply(200, { user_id: invited.user.id })
}
