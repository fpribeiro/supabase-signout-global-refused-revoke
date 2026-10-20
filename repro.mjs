// Reproduces: since @supabase/auth-js 2.110.2 (supabase-js PR #2504),
// signOut({ scope: 'global' }) removes the local session and emits
// SIGNED_OUT before returning the error of a failed remote logout.
//
// Runs against a local Supabase stack (`supabase start`) or any project.
// Needs: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// The service-role key only mints and deletes a throwaway user.

const which = process.argv[2] ?? 'supabase-js-new';
const { createClient } = await import(which);

const URL_ = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (local: `supabase status -o env`).');
  process.exit(2);
}

const admin = async (path, body, method = 'POST') => {
  const r = await fetch(`${URL_}/auth/v1${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

// 1. A throwaway user with a real session, minted without a mailbox.
const email = `repro-${Date.now().toString(36)}@signout-repro.dev`;
const user = await admin('/admin/users', { email, email_confirm: true });
const link = await admin('/admin/generate_link', { type: 'magiclink', email });
const verify = await fetch(`${URL_}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
});
const session = await verify.json();
if (!session.access_token) throw new Error('could not mint a session: ' + JSON.stringify(session));

// 2. A client whose remote logout is refused by the server (any 5xx).
const supabase = createClient(URL_, ANON, {
  auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: (url, init) =>
      String(url).includes('/auth/v1/logout')
        ? Promise.resolve(
            new Response(JSON.stringify({ error: 'internal', error_description: 'repro' }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            }),
          )
        : fetch(url, init),
  },
});
const events = [];
supabase.auth.onAuthStateChange((event) => events.push(event));
await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
events.length = 0;

// 3. The call under test.
const { error } = await supabase.auth.signOut({ scope: 'global' });
const emitted = [...events];
const { data } = await supabase.auth.getSession();
const { error: again } = await supabase.auth.signOut({ scope: 'global' });

// 4. The server's view: a token the server never revoked still works.
const me = await fetch(`${URL_}/auth/v1/user`, {
  headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` },
});

const pkg = JSON.parse(
  await (await import('node:fs/promises')).readFile(new URL(`./node_modules/${which}/package.json`, import.meta.url), 'utf8'),
);
console.log(`@supabase/supabase-js ${pkg.version}`);
console.log(`  signOut({ scope: 'global' }) returned error: ${error ? `${error.status} ${error.message}` : 'none'}`);
console.log(`  events emitted by that call:            ${emitted.length ? emitted.join(', ') : 'none'}`);
console.log(`  local session afterwards:               ${data.session ? 'PRESENT (retry possible)' : 'NULL (gone)'}`);
console.log(`  a second signOut() returned error:      ${again ? `${again.status} ${again.message}` : 'none'}`);
console.log(`  server still accepts the access token:  ${me.status === 200 ? 'YES (nothing was revoked)' : me.status}`);

await admin(`/admin/users/${user.id}`, null, 'DELETE');
