import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

interface Mail {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null | undefined;

function getTransporter() {
  if (transporter !== undefined) return transporter;
  const url = env().SMTP_URL;
  transporter = url ? nodemailer.createTransport(url) : null;
  return transporter;
}

/** Sends via SMTP_URL when configured; otherwise logs to stdout (dev / test). Never throws. */
export async function sendMail(mail: Mail): Promise<void> {
  const t = getTransporter();
  if (!t) {
    if (env().NODE_ENV !== "test") console.info(`[mail:dev] to=${Array.isArray(mail.to) ? mail.to.join(",") : mail.to} subject="${mail.subject}"`);
    return;
  }
  try {
    await t.sendMail({ from: env().EMAIL_FROM, ...mail });
  } catch (e) {
    console.error("sendMail failed", e);
  }
}
