# Block and meeting reminders

Calendar blocks and meetings have two default reminders: **10 minutes before** and **at the start**. Open Inbox to change the lead time, toggle each channel, choose the device time zone, and read notifications. Meeting dates are entered in local device time and saved in UTC. Auto-scheduling treats meetings as occupied time.

## What is implemented

- Durable, user-scoped in-app inbox with unread count, mark-as-read, and calendar navigation.
- Expo remote push registration, Android notification channel, foreground banners, tap handling, token renewal, and device removal on logout/session expiry.
- Resend transactional email integration to the signed-in account's email address. No meeting invitations or emails to other attendees are sent.
- Database delivery leases, stable IDs, Resend idempotency keys, bounded retries, Expo ticket/receipt checks and invalid-device removal. Inbox status distinguishes provider acceptance from handoff; it never asserts that a person saw a message.
- Live state and preferences are checked before dispatch. Deleted/rescheduled events and completed tasks do not produce future notifications. Pending deliveries are cancelled after deletion or opt-out.

## Required server deployment

Deploy this repository's updated server on Render and the `client` build on Vercel. Keep the website's existing `/api` proxy pointed at the backend. The Expo app can use the same backend by setting `EXPO_PUBLIC_API_URL` to its HTTPS `/api` endpoint and rebuilding. Existing accounts can be retained by using the existing Neon database; tables are added without modifying existing user data. Older clients that omit meetings do not erase them. Deploy the backend before the frontend so meeting writes are supported.

Environment variables (backend only):

```dotenv
RESEND_API_KEY=<Resend sending API key>
EMAIL_FROM=FocusFlow <reminders@your-verified-domain.example>
PUSH_ENABLED=true
# Optional; required if Expo enhanced push security is enabled:
EXPO_ACCESS_TOKEN=<Expo push access token>
REMINDER_CRON_SECRET=<random secret of at least 32 characters>
```

Verify a sender domain in Resend, then set the key and sender in Render's environment settings. The sender address above is a placeholder. Resend's testing sender has recipient restrictions; it is not a general production sender. Never put these credentials in `EXPO_PUBLIC_*`, source control, or the app binary. No Resend account, paid subscription, sender domain or live delivery has been configured by this change.

In-app reminders default on. Email and push require the user's opt-in in Inbox. The settings screen distinguishes configured providers from preferences that cannot deliver yet. Email goes only to the account email; the app does not yet implement account-email verification, so consider adding verified ownership before opening public registrations at scale.

## Scheduler and free hosting

The server runs a worker every 30 seconds while awake. **Render Free sleeps**, so that interval alone cannot provide timely reminders. Configure an external scheduler to call this authenticated endpoint every minute:

```http
POST https://YOUR-API-HOST/api/internal/reminders/run
Authorization: Bearer YOUR_REMINDER_CRON_SECRET
Content-Type: application/json

{}
```

Keep the secret in the scheduler's protected headers, not the URL. Setting the secret does not create a scheduler. If you run the server continuously, set `REMINDER_ALWAYS_ON=true` only when that is actually true. `REMINDER_WORKER_DISABLED=true` disables the interval when using only the external trigger.

Free-service cold starts, provider queues, network outages and device notification settings can delay delivery; this is not an exact alarm guarantee. A pre-start push/email is skipped once the event begins, and no external reminder is sent after its event ends or more than 15 minutes late. Missed in-app entries can be materialized on the next inbox refresh within seven days; history is retained for 30 days. Provider failure retries are bounded to five attempts. Expo has no idempotency key for sending, so a process crash after provider acceptance but before recording it can occasionally duplicate a push.

## Native build setup

1. Link an EAS project. Set its project ID in `extra.eas.projectId`, or set `EXPO_PUBLIC_EAS_PROJECT_ID` at build time.
2. Configure Android FCM v1 credentials and iOS APNs credentials in EAS. These stay with EAS/provider configuration, not Git.
3. Build and install a development or production app with the `expo-notifications` plugin. Remote push does not run in Expo Go on Android.
4. Sign in, open Inbox, choose **Enable push on this device**, and grant OS notification permission. Repeat on each device.
5. Enable email reminders after configuring the sender. Schedule a future meeting, then verify the inbox, actual device notification and email received at both offsets. Check delivery status and Expo receipts if a channel fails.

Web supports the in-app inbox, not browser push. Native background delivery uses Expo Push Service; no background JS timer or local duplicate reminder is scheduled. Notification preferences and authentication expire independently of OS permission; signing out unregisters the current session's devices.

Official setup references: [Expo SDK 57 Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/), [Expo push delivery](https://docs.expo.dev/push-notifications/sending-notifications/), [Resend send email](https://resend.com/docs/api-reference/emails/send-email).
