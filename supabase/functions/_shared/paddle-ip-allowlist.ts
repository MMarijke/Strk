// Defense-in-depth for paddle-webhook: Paddle's signature check (HMAC over
// PADDLE_WEBHOOK_SECRET) is the real authenticity boundary and is sufficient
// on its own -- this adds a second, independent layer by also requiring the
// request to originate from one of Paddle's published sending IPs.
//
// The IP list is NOT hard-coded: Paddle documents it as subject to change
// and publishes the current set at https://api.paddle.com/ips (unauthenticated,
// { data: { ipv4_cidrs: string[], ... } }, all entries currently /32s). This
// fetches that list and caches it in-memory for the life of the isolate.

const IPS_ENDPOINT = "https://api.paddle.com/ips";
// Re-fetch at most once an hour -- Paddle's IPs don't change often, and this
// keeps the endpoint off the hot path for every webhook delivery.
const CACHE_TTL_MS = 60 * 60 * 1000;

let cachedCidrs: string[] | null = null;
let cachedAt = 0;

async function fetchAllowedCidrs(): Promise<string[]> {
  const res = await fetch(IPS_ENDPOINT);
  if (!res.ok) throw new Error(`Paddle IP list fetch failed: ${res.status}`);
  const body = await res.json();
  const cidrs = body?.data?.ipv4_cidrs;
  if (!Array.isArray(cidrs) || cidrs.length === 0) {
    throw new Error("Paddle IP list response had no ipv4_cidrs");
  }
  return cidrs;
}

async function getAllowedCidrs(): Promise<string[]> {
  const now = Date.now();
  if (cachedCidrs && now - cachedAt < CACHE_TTL_MS) return cachedCidrs;

  try {
    const cidrs = await fetchAllowedCidrs();
    cachedCidrs = cidrs;
    cachedAt = now;
    return cidrs;
  } catch (err) {
    // If we have a stale-but-present list, prefer it over failing every
    // webhook delivery just because Paddle's IP-list endpoint had a blip --
    // the signature check still guards authenticity either way.
    if (cachedCidrs) return cachedCidrs;
    throw err;
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const octet = Number(p);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = bitsStr ? Number(bitsStr) : 32;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || !Number.isInteger(bits)) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

// Supabase's edge runtime sits behind a proxy that sets x-forwarded-for to
// "<client>, <proxy1>, ..." -- the first entry is the original caller.
function callerIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

/**
 * Returns true if the request's source IP is one of Paddle's published
 * webhook-sending addresses. Fails open (returns true) only when the caller's
 * IP can't be determined at all or the IP list can't be fetched on a cold
 * cache -- never fails open on a definite, resolved mismatch.
 */
export async function isFromPaddle(req: Request): Promise<boolean> {
  const ip = callerIp(req);
  if (!ip) return true;

  let cidrs: string[];
  try {
    cidrs = await getAllowedCidrs();
  } catch {
    return true;
  }

  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}
