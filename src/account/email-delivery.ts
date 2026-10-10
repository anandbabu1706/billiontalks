/** Outbound transactional email adapter. No token, API key, or provider response is logged. */
export interface AccountEmailSender {
  sendVerification(email: string, token: string): Promise<void>;
  sendPasswordReset(email: string, token: string): Promise<void>;
}
export type AccountEmailConfig = {
  RESEND_API_KEY?: string;
  ACCOUNT_EMAIL_FROM?: string;
  ACCOUNT_PUBLIC_ORIGIN?: string;
};
export function createAccountEmailSender(config: AccountEmailConfig): AccountEmailSender | null {
  const { RESEND_API_KEY: key, ACCOUNT_EMAIL_FROM: from, ACCOUNT_PUBLIC_ORIGIN: origin } = config;
  if (!key || !from || !origin) return null;
  let base: URL;
  try {
    base = new URL(origin);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
  } catch { return null; }
  async function deliver(to: string, subject: string, path: string, token: string): Promise<void> {
    const link = new URL(path, base);
    link.searchParams.set("token", token);
    // Keep token in email body only, never request logs or provider-specific API errors.
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject,
        text: `Open this link to continue: ${link.toString()}\n\nIf you did not request this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Transactional email delivery failed.");
  }
  return {
    sendVerification: (email, token) => deliver(email, "Verify your BillionTalks email", "/account", token),
    sendPasswordReset: (email, token) => deliver(email, "Reset your BillionTalks password", "/account", token),
  };
}
