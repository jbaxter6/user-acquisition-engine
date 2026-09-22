# Meta App Review — Submission Notes

Reference material for submitting the "Acquisition Engine-IG" app for App
Review to get `instagram_business_manage_messages` (and
`instagram_business_basic`) approved at Advanced Access, so the connected
account(s) can receive and respond to messages from any Instagram user —
not just registered testers.

This is prep material, not a legal document — copy/adapt the text below
directly into Meta's App Review form fields.

## Before submitting

- [ ] Complete Business Verification in Meta Business Manager, if prompted (Advanced Access to messaging permissions may require it)
- [x] Privacy policy live at `https://www.movewithsmooth.com/privacy` (source: `client/public/privacy.html`, served publicly — ahead of the site password gate — via `server/src/index.ts`)
- [ ] Terms of service URL, if Meta's form requires one (not yet drafted — flag if needed)
- [ ] App icon, if required by the submission form
- [ ] Screen recording demonstrating the permission in use (see script below) — record this yourself using the real running app

## Permissions being requested

- `instagram_business_basic`
- `instagram_business_manage_messages`

## Use-case description (paste into the review form)

> Our business uses the Instagram Messaging API to operate a centralized
> support inbox for our Instagram Business account(s). When a creator,
> partner, or member of the public sends a direct message to one of our
> connected Instagram accounts, that message is displayed in our internal
> dashboard, where a team member reviews it and replies directly through
> the API. This lets our team manage and respond to inbound Instagram
> messages consistently, in one place, instead of manually checking each
> connected account's Instagram app individually. We do not use this
> permission to send unsolicited messages — it is used to receive and
> respond to messages initiated by the other party, within Meta's standard
> messaging window and tag rules.

## Screen recording script

Meta typically requires a video showing the permission in actual use, start
to finish, in the real app (not a mockup):

1. Show the Instagram account sending a message to the connected Smooth
   Instagram Business account, from a separate device/account.
2. Switch to the Smooth dashboard (`client/`), show the message arriving in
   the Unified Master Inbox conversation list.
3. Open the conversation, show the message content.
4. Type and send a reply from the dashboard.
5. Switch back to the Instagram app, show the reply arriving there.

## Notes on framing

The use-case description above is written around **responding to inbound
messages**, since that's what the permission itself governs and what
reviewers evaluate — not how the original conversation started. Worth
being aware of: our actual usage pattern involves reaching out first via
outreach messages (see `README.md` "Mass Distribution Layer"), and Meta's
Platform Terms restrict bulk/unsolicited messaging. The receiving/replying
behavior described here is accurate and is what the permission covers:
it does not describe or authorize how contact is initiated on our end,
so this documentation does not remove that consideration.
