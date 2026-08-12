// Shared email sender for the api/send-*.js endpoints. Tries Gmail SMTP
// first (works for any recipient immediately, no domain verification --
// good for a small team while a real sending domain isn't set up yet),
// then falls back to Resend's HTTP API (only reaches the Resend account's
// own address until a domain is verified at resend.com/domains), then
// falls back to an honest "not configured" response instead of silently
// pretending to send.
//
// Env vars, checked in this order:
//   GMAIL_USER / GMAIL_APP_PASSWORD  - a Gmail address + an app password
//                                      (myaccount.google.com/apppasswords,
//                                      requires 2-Step Verification). Not
//                                      the account's normal login password.
//   RESEND_API_KEY                   - API key from https://resend.com
//   SUBMITTAL_FROM_EMAIL             - optional sender override for Resend

import nodemailer from "nodemailer";

let gmailTransporter;

function getGmailTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return null;
  }
  if (!gmailTransporter) {
    gmailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return gmailTransporter;
}

export async function sendEmail({ to, subject, html, fromName }) {
  const senderName = fromName || "Ergon Ops";

  const gmail = getGmailTransporter();
  if (gmail) {
    try {
      await gmail.sendMail({
        from: `${senderName} <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
      });
      return { sent: true };
    } catch (error) {
      return { sent: false, error: error instanceof Error ? error.message : "Could not send email via Gmail SMTP." };
    }
  }

  if (process.env.RESEND_API_KEY) {
    const from = process.env.SUBMITTAL_FROM_EMAIL || `${senderName} <onboarding@resend.dev>`;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { sent: false, error: `Email provider returned ${response.status}: ${errorBody}` };
      }
      return { sent: true };
    } catch (error) {
      return { sent: false, error: error instanceof Error ? error.message : "Could not send email via Resend." };
    }
  }

  return {
    sent: false,
    reason: "Email delivery isn't configured yet (set GMAIL_USER/GMAIL_APP_PASSWORD or RESEND_API_KEY in Vercel), so no email was sent.",
  };
}
