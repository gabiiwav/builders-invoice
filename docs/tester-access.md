# Tester access

The shared beta code grants each authenticated account 60 days of Business access without creating or changing a Stripe subscription.

Share this link:

`https://www.buildersinvoice.com/app.html?tester=BUILDERS-BETA-2026`

The tester signs up or logs in normally. The browser temporarily retains the code through email confirmation, then the authenticated server redeems it. Access starts at redemption, can be redeemed only once per account, and expires automatically. Existing paid subscriptions remain unchanged.

The campaign currently allows 100 testers and new redemptions through January 31, 2027. Change those controls in `tester_campaigns`; disabling the campaign stops new redemptions without removing already-granted access.

The plaintext code is not stored in Vercel. `TESTER_ACCESS_CODE_HASH` contains only its SHA-256 hash. Tester entitlement fields are server-managed and the database quota trigger treats an unexpired tester as Business.
