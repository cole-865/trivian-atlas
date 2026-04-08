const RESEND_API_URL = "https://api.resend.com/emails";

export type SendEmailInput = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string[];
};

export type EmailSendResult = {
  sent: boolean;
  reason: string | null;
};

function getResendApiKey() {
  return process.env.RESEND_API_KEY?.trim() ?? "";
}

function getEmailFrom() {
  return process.env.EMAIL_FROM?.trim() ?? "";
}

export function isEmailDeliveryConfigured() {
  return !!getResendApiKey() && !!getEmailFrom();
}

export async function sendEmail(input: SendEmailInput): Promise<EmailSendResult> {
  const apiKey = getResendApiKey();
  const from = getEmailFrom();

  if (!apiKey || !from) {
    return {
      sent: false,
      reason:
        "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM to enable sending.",
    };
  }

  if (!input.to.length) {
    return {
      sent: false,
      reason: "No email recipients were provided.",
    };
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? input.text.replace(/\n/g, "<br />"),
      reply_to: input.replyTo,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    return {
      sent: false,
      reason: details || `Email provider returned ${response.status}.`,
    };
  }

  return {
    sent: true,
    reason: null,
  };
}
