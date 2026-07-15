// Sends the welcome email via Resend once onboarding completes.
// Invoked directly from the client (supabase.functions.invoke) — protected by
// the caller's JWT (default verify_jwt behavior), not a webhook.
import { emailShell } from "../_shared/email-template.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS") ?? "Strk <hello@strk.app>";

Deno.serve(async (req) => {
  try {
    const { email, display_name } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "email is required" }), { status: 400 });
    }

    const name = display_name || email.split("@")[0];
    const html = emailShell({
      preheader: "Welcome to Strk — let's build your first streak.",
      heading: `Welcome, ${name} 🔥`,
      body: `
        <p>Strk helps you build habits that stick — one day at a time.</p>
        <p>Here's how to get the most out of it:</p>
        <ul>
          <li>Add your first habit from the Dashboard</li>
          <li>Check in daily to keep your streak alive</li>
          <li>Join or create a group to stay accountable with friends</li>
        </ul>
      `,
      ctaLabel: "Open Strk",
      ctaUrl: "https://strk.app/Dashboard",
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: email,
        subject: "Welcome to Strk 🔥",
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("send-welcome-email: Resend API error", res.status, errText);
      return new Response(JSON.stringify({ error: "Failed to send email" }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("send-welcome-email: unexpected error", err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), { status: 500 });
  }
});
