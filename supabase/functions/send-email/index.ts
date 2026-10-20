// Supabase Auth "Send Email" hook: Auth calls this instead of sending its own
// email, and it sends through Resend using a Resend template. That covers
// both the invite (invite-user → inviteUserByEmail) and "Forgot password?"
// (resetPasswordForEmail) without either caller changing, and keeps Supabase's
// own rate limits on reset requests.
//
// Deploy:  supabase functions deploy send-email --no-verify-jwt
// Then:    Authentication → Hooks → Send Email hook → HTTPS → this function's
//          URL; generate the secret there.
// Secrets (supabase secrets set …):
//   SEND_EMAIL_HOOK_SECRET    the hook secret, as shown ("v1,whsec_…")
//   RESEND_API_KEY            Resend API key with sending access
//   RESEND_INVITE_TEMPLATE    Resend template id or alias for invites
//   RESEND_RECOVERY_TEMPLATE  Resend template id or alias for password resets
//   RESEND_FROM               optional, e.g. "LC Basketball <noreply@lcbasketball.com>";
//                             only needed if the templates don't set a sender
// Templates get these variables: ACTION_URL (the sign-in link), EMAIL,
// DISPLAY_NAME and ROLE (blank when unknown).
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

interface HookPayload {
  user: {
    email: string
    user_metadata?: { display_name?: string | null; role?: string | null }
  }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
  }
}

function reply(status: number, message?: string) {
  const body = message ? { error: { http_code: status, message } } : {}
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, 'POST only')

  const raw = await req.text()
  let payload: HookPayload
  try {
    const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')!.replace(/^v1,whsec_/, '')
    payload = new Webhook(secret).verify(raw, Object.fromEntries(req.headers)) as HookPayload
  } catch (e) {
    console.error('Bad hook signature', e)
    return reply(401, 'Invalid signature.')
  }

  try {
    await send(payload)
    return reply(200)
  } catch (e) {
    // Auth passes this message on to the caller (e.g. the invite dialog).
    console.error(e)
    return reply(500, `Email failed: ${e instanceof Error ? e.message : String(e)}`)
  }
})

async function send({ user, email_data: d }: HookPayload) {
  // The same link Supabase's own emails use: it verifies the token, then
  // redirects to the app with the session in the hash (see src/main.ts).
  const link = new URL('/auth/v1/verify', Deno.env.get('SUPABASE_URL')!)
  link.searchParams.set('token', d.token_hash)
  link.searchParams.set('type', d.email_action_type)
  link.searchParams.set('redirect_to', d.redirect_to || d.site_url)
  const actionUrl = link.toString()

  const templates: Record<string, string | undefined> = {
    invite: Deno.env.get('RESEND_INVITE_TEMPLATE'),
    recovery: Deno.env.get('RESEND_RECOVERY_TEMPLATE'),
  }
  const template = templates[d.email_action_type]
  const from = Deno.env.get('RESEND_FROM')

  let email: Record<string, unknown>
  if (template) {
    email = {
      to: [user.email],
      template: {
        id: template,
        variables: {
          ACTION_URL: actionUrl,
          EMAIL: user.email,
          DISPLAY_NAME: user.user_metadata?.display_name ?? '',
          ROLE: user.user_metadata?.role ?? '',
        },
      },
    }
  } else if (d.email_action_type in templates) {
    throw new Error(`Set the Resend template for ${d.email_action_type} emails (see send-email/index.ts).`)
  } else {
    // Sign-up is off, so the app never asks for these; once the hook is on,
    // Auth still routes them here, so send something usable rather than fail.
    if (!from) throw new Error('Set RESEND_FROM to send this email.')
    email = {
      to: [user.email],
      subject: 'Confirm your LC Basketball account',
      html: `<p><a href="${actionUrl}">Continue to LC Basketball</a></p><p>Or enter this code: ${d.token}</p>`,
    }
  }
  if (from) email.from = from

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(email),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message ?? `Resend answered ${res.status}`)
  }
}
