# Pocket Pager: the managers' app (App Store + Google Play)

Owner's brief: 2026-11-20. It replaces the self-serve sign-up of PR #67, whose code stays in place, switched off.

## Who does what
- **Aurexis (/super):**
  - creates the client in one step: brand + first branch + the owner's account;
  - adds branches, records payments, stops and resumes branches and accounts.
  - It is never in the apps.
- **Brand owner:** sees every branch of their brand.
- **Branch manager:** sees their branch only.
  - Same rules as /brand: `owners.branch_id`, enforced by the server.
- **Cashier:** unchanged: web, the Windows app, the side-loaded Android app.

## Sign-in
- Phone or username, plus the password: `POST /api/login`, the same endpoint as the website.
- **Never signed out by time.** The owner cookie lasts 400 days and is renewed on every dashboard load. A session ends only on:
  - «خروج»;
  - a new password from /super (`pw_version`);
  - the account stopped by /super (`owners.disabled_at`);
  - the brand trashed.
- No sign-up and no "forgot password" in the apps. Instead: «لحساب جديد أو نسيت الباسورد كلّمنا على واتساب» and a button to WhatsApp (`PAY_WHATSAPP`).

## /signup
- It becomes a **request form**: name, phone, restaurant name, number of branches.
- `POST /api/account-requests` stores the request, and it shows in /super under «محتاج منك».
- The page then offers the same message on WhatsApp.
- No account is created.
- **Why this over closing it:**
  - the landing page's «ابدأ» keeps working;
  - requests are never lost when nobody watches WhatsApp;
  - Aurexis still creates every account.
- `SIGNUP=on` brings the old self-serve sign-up back (the tests use it).

## One data, live everywhere
- Every client reads the same API.
- `GET /api/brand/:brand/events` (SSE): «changed» whenever anything of the brand's branches changes:
  - orders, settings, pause;
  - the super's plan changes;
  - cashier screens opening or closing;
  - new branches or managers.
- /brand on the web and the iOS app refresh on it.
- The Android app refreshes every 10 s while open.

## Notifications
- **Stored:** `owner_alerts` keeps each alert once (`dedupe` key).
- **Shown:**
  - in-app list: `GET /api/brand/:brand/alerts`;
  - iOS push: APNs alert to `cc.aurexis.pager`, same key as the Live Activity; devices sent with `POST /api/brand/:brand/push-devices`;
  - Android: a JobScheduler check every 15 min plus on open, shown as Android notifications. No Firebase (no Gradle in this repo).
- **What triggers one:**
  - branch paused or opened;
  - branch stopped: trial over, unpaid, by hand, or waiting for payment;
  - subscription ending in 3 days or tomorrow;
  - past due;
  - cashier screen closed at a usually busy hour (`screenAlert`).
- A manager gets only their branch's alerts.

## The apps
- **iOS** (an update of `cc.aurexis.pager`, 1.2.0). Customers' order screen, App Clip, Live Activity and widget are untouched. Native tabs:
  - **الفروع:** each branch with today's orders, open now, late, cashier online or offline, and its plan; a tap opens the branch.
  - **التنبيهات:** the alerts.
  - **الإدارة:** the full /brand page, signed in (web view).
  - **حسابي:** name, role, WhatsApp, sign out.
- **Android** (new app `cc.aurexis.pocketpager`): native sign-in, native branches list and alerts, the full /brand page in a web view, and notifications.
- **Nothing is sold** in either app: no prices, no «اشترك». Only «كلّمنا على واتساب».

## /super
- **«عميل جديد»:** in one form, the brand + first branch + owner. It answers with a WhatsApp message ready to copy, containing:
  - the store links;
  - username and password;
  - cashier and QR links, and the cashier PIN.
- **Account requests** from /signup show under «محتاج منك».
- **Stop or resume an owner or manager account.**

## App review account
- Created by the server on start, like the demo café:
  - brand `review-cafe` with two branches and realistic orders, refreshed daily;
  - owner `01099990001` / `REVIEW_PASSWORD` (default `PocketReview1`).
- The brand is read-only, like the demo.

## Store zips
- One zip per store.
- Each has an Arabic instructions file that lists every store field with what to paste.
- **App Store zip:** `source/`, `screenshots/`.
- **Google Play zip:** the signed `.aab`, the icon, the feature graphic, `screenshots/`.
