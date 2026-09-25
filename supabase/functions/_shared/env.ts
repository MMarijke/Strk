// Every edge function read its required secrets via `Deno.env.get("X")!` --
// the `!` is a compile-time-only assertion; if the secret was never actually
// set in Supabase, this silently evaluates to `undefined` at runtime, and
// that `undefined` then propagates downstream (e.g. into an
// `Authorization: Bearer ${undefined}` header) until a third party rejects
// it with a confusing, hard-to-trace error. That's exactly what happened
// with RESEND_API_KEY: Resend's "API key is invalid" 401 was the first
// visible symptom of a secret that was simply never configured.
//
// requireEnv() fails loudly at the point of use instead -- a missing secret
// now throws a clear, named error immediately, so it surfaces as an
// obvious startup/cold-start failure rather than a mysterious downstream
// error days later.
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
