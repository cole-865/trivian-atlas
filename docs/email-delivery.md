# Email delivery setup

Trivian Atlas now uses Resend's REST API for app-generated emails.

## Required environment variables

Add these to `.env.local` and your deployed environment:

```env
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=Atlas <notifications@yourdomain.com>
NEXT_PUBLIC_SITE_URL=https://your-app-url
```

## What sends email now

- Account invites from Settings
- Initial admin invite when a new account is created
- Deal submission notifications to active `management` and `admin` users in the current account

## Current behavior when not configured

- Invites are still created
- The UI falls back to a shareable acceptance link
- Deal submissions still complete, but approval emails are skipped

## Next reuse point

The shared email helpers in `src/lib/email/` are ready to be reused for exception-request notifications once that workflow is wired into the repo.
