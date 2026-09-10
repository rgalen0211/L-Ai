# L'Ai

AI workflow automation and practical implementation for small businesses.

Website: https://uselai.com

## Workflow Audit funnel — Pass 1

Static landing page: `/workflow-audit/` (directory index; `/workflow-audit` resolves with a trailing slash on directory-serving hosts).
Dedicated confirmation/scheduling page: `/workflow-audit-thanks.html`.
The existing general contact form and `thank-you.html` are unchanged.

The audit form reuses Formspree `https://formspree.io/f/xyklqewj`, tagged
`submission_type=workflow_audit`, with its own subject and source. It requires
only name, email, and task. Company, people, hours, and systems are optional;
Other software is an optional detail of the systems field.

With JavaScript, the form requests JSON and navigates to
`/workflow-audit-thanks.html?ref=fs` only when the HTTP response is successful
and Formspree returns `ok: true`. Errors retain the entered values and restore
the submit button. A 30-second timeout reports uncertain delivery without
automatically retrying. The query marker is navigation context, not proof of
submission. No Meta or GA4 tracking is implemented in Pass 1.

Without JavaScript, the native form still posts to Formspree. The observed
endpoint ignores `_redirect`; the noscript note explains returning after
Formspree's confirmation to continue to scheduling. A fully automatic native
redirect is not verified or configured.

### Real submission checks — September 10, 2026

Tests used explicitly labeled QA data and the public L'Ai contact address.
All browser tests originated from the local preview, not deployed production.

| Test | Observed result |
| --- | --- |
| `20260910-A` — native audit POST | Formspree displayed “The form was submitted successfully.” Destination: `https://formspree.io/thanks?language=en`. `_redirect=https://uselai.com/workflow-audit-thanks.html?ref=fs` was not honored; the custom query was not carried to our page. |
| `20260910-B` — audit AJAX POST | Successful response passed both the HTTP-success and `ok: true` checks; browser reached `http://127.0.0.1:4173/workflow-audit-thanks.html?ref=fs`. Included Google Workspace, Other, an Other detail, and people 2–5. |
| `20260910-C` — unchanged general contact POST | Formspree confirmed successful submission and returned to its hosted thank-you page, not the audit page. Its existing `_redirect` was also not honored. |

Inbox delivery is **not confirmed**: targeted searches of the connected
`ryan.galen@uselai.com` mailbox, including spam/trash, returned no matching
receipts. Formspree dashboard access requires sign-in. Ryan should check the
submission/spam records for `xyklqewj` using the above markers, then verify the
notification recipient and delivery settings. Do not infer inbox receipt from
an HTTP success response.

No dashboard changes are required for the tested JavaScript redirect, and none
were made. Do not change the shared endpoint's global redirect to the audit
page: that could also redirect general inquiries. If a native per-form redirect
is desired, first inspect the account's available conditional redirect features
and plan; do not assume `_redirect` works.

Booking CTA verified to open Ryan Galen's “L'Ai 15-Minute Intro” in Google
Calendar, showing 15-minute appointments and available slots. No booking made.
URL: https://calendar.app.google/SrHAqNaF4DMTgo4EA

### QA and review limits

- Browser checks: required-field and email validation, conditional Other input,
  pending submit state, real success navigation, keyboard focus, and scheduling.
- Desktop visual check at 1280px; mobile at 390px and narrow 320px. No horizontal
  overflow on the checked pages. Form text controls are 16px with at least 48px
  height, and checkbox labels provide 44px targets.
- Run dependency-free submission safety tests with
  `node --test tests/workflow-audit.test.cjs`.
- Static site; no build step. The new pages share only their own CSS/JS assets.
- No pricing, new palette colors, tracking, CRM work, or unrelated site changes.
- Privacy policy and policy links remain for the explicitly scheduled Pass 3.
- Before campaign traffic: confirm delivery, complete the later approved passes,
  and repeat the form/navigation checks on the deployed origin. Branch push does
  not publish these pages to the main-based site.
