// Shared HTML shell for transactional emails, using Strk's muted earthy
// palette (mirrors the --primary/--accent/--foreground CSS variables in
// src/index.css) so emails feel consistent with the in-app UI.
const COLORS = {
  background: "#fbfbf9",
  card: "#ffffff",
  foreground: "#14181f",
  muted: "#6a7181",
  border: "#e3e5e8",
  primary: "#e89830",
  accent: "#f7cb64",
};

export function emailShell({
  preheader,
  heading,
  body,
  ctaLabel,
  ctaUrl,
}: {
  preheader: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background:${COLORS.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;">
    <span style="display:none;font-size:1px;color:${COLORS.background};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      ${preheader}
    </span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.background};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,${COLORS.primary},${COLORS.accent});padding:28px 32px;">
                <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">Strk 🔥</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${COLORS.foreground};letter-spacing:-0.02em;">
                  ${heading}
                </h1>
                <div style="font-size:14px;line-height:1.7;color:${COLORS.foreground};">
                  ${body}
                </div>
                ${
                  ctaUrl
                    ? `<div style="margin-top:24px;">
                        <a href="${ctaUrl}" style="display:inline-block;background:${COLORS.primary};color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:12px;">
                          ${ctaLabel ?? "Open Strk"}
                        </a>
                      </div>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${COLORS.border};">
                <p style="margin:0;font-size:12px;color:${COLORS.muted};">
                  Build streaks. Stay accountable.<br />
                  Strk
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
