# Pocket Pager — Product

Written from the owner's brief (2026-11-20). Items marked *(assumed)* were inferred, not stated.

## What it is
A pager replacement for cafés and restaurants. The customer scans a QR code at the cashier, gets an order number on their phone (no app), and the phone rings when the order is ready. Made by Aurexis.

## Who uses it
- **Restaurant / café owner:** signs up alone, from a phone. Not technical. People told the owner the product "is complicated and needs explaining". They should be able to start without anyone helping them.
- **Branch manager:** runs one branch and sees only that branch.
- **Cashier:** taps orders on the cashier screen, usually on a tablet or a counter PC.
- **Customer:** scans and waits. They never sign up.

## What success looks like
- Simple enough that "a child could use it". Every field says what it is, what to type in it, and why it matters, in one short line of Egyptian Arabic.
- An owner goes from "open the app" to "the cashier screen is running" in under 3 minutes:
  1. account;
  2. restaurant name and link;
  3. first branch;
  4. ready links and PIN.
- Every feature switch says in plain words what it does and who sees it.

## Business rules
- **Trial:** a 3-day free trial, once per phone and per device.
- **Extra branches:** a branch added after the trial needs a subscription before it works.
- **Prices:** in EGP, per branch per month.
  - 1 branch costs 2,500. The price steps down to 1,500 at 100 branches and never goes below that.
  - The table lives in `server/public/js/pricing.js`.
- **Payment:** the owner sends the request, pays by InstaPay or wallet *(assumed: no payment gateway yet)*, and Aurexis confirms it from /super.
- **Defaults on a new branch:** delivery is on, and the takeaway receipt box above the count is on.

## Platforms
- **Web:** responsive, Bootstrap 5.3 RTL for the grid and utilities, with our own tokens.
- **Native:** the iOS and Android store apps open the same flows *(Android store build: next step)*.

## Brand
- Look: navy + orange (brand/pocket-pager-brand/BRAND.md), Readex Pro, Arabic first and RTL.
- A café's own logo colour still themes its own pages.
- Voice: Egyptian Arabic, short and warm.
