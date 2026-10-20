# supabase-js: a refused global sign-out clears the local session first

Since `@supabase/auth-js` 2.110.2 (supabase-js PR #2504, fixing #2501),
`signOut({ scope: 'global' })` removes the local session and emits
`SIGNED_OUT` **before** returning the error of a failed remote logout.
The server revoked nothing, the other devices stay signed in, and the
client no longer holds the tokens it would need to retry.

This repository runs the same script against 2.108.2 and 2.118.0.

## Run

Against a local Supabase stack:

```bash
supabase start                      # in any Supabase project directory
eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=$ANON_KEY
export SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY

npm install
npm run old   # @supabase/supabase-js 2.108.2
npm run new   # @supabase/supabase-js 2.118.0
```

Any hosted project works the same with its URL, anon key and
service-role key. The script mints one throwaway user, signs it in
without a mailbox, refuses the client's `POST /auth/v1/logout` with a
500 through the documented `global.fetch` option, calls
`signOut({ scope: 'global' })`, and deletes the user.

## What it prints

2.108.2:

```
@supabase/supabase-js 2.108.2
  signOut({ scope: 'global' }) returned error: 500 {}
  events emitted by that call:            none
  local session afterwards:               PRESENT (retry possible)
  a second signOut() returned error:      500 {}
  server still accepts the access token:  YES (nothing was revoked)
```

2.118.0:

```
@supabase/supabase-js 2.118.0
  signOut({ scope: 'global' }) returned error: 500 repro
  events emitted by that call:            SIGNED_OUT
  local session afterwards:               NULL (gone)
  a second signOut() returned error:      none
  server still accepts the access token:  YES (nothing was revoked)
```

On 2.118.0 the only signal that nothing was revoked is the first
call's return value, after `SIGNED_OUT` has already fired; the second
call has no token to send and reports success. (The `{}` on 2.108.2 is
that version's message for a 5xx body; 2.112.1 started preserving the
server's message.)
