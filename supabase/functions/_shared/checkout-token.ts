// Paddle Checkout's custom_data is fully client-controlled -- anyone can
// call the Paddle.js SDK directly (bypassing our UI) with arbitrary
// custom_data. paddle-webhook previously trusted a client-supplied email
// there as the join key back to a Strk user, which let anyone link a real
// purchase to an arbitrary victim's account (see git history on
// paddle-webhook/index.ts for the incident this fixes).
//
// This token is minted server-side, only for the caller's own session (see
// create-checkout-token), so custom_data instead carries a value the client
// cannot forge: an HMAC-signed, short-lived binding of the *authenticated*
// caller's own user id.
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// Checkout sessions are opened and completed within minutes; this only
// needs to outlive one, with slack for a slow/abandoned-then-resumed flow.
const TOKEN_TTL_MS = 60 * 60 * 1000;

export function signCheckoutToken(userId: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

// Returns the bound user id if `token` carries a valid, unexpired signature
// for `secret`, otherwise null. Never throws on malformed input.
export function verifyCheckoutToken(token: string, secret: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }

  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof uid !== "string" || typeof exp !== "number" || Date.now() > exp) return null;
    return uid;
  } catch {
    return null;
  }
}
