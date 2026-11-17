# Pocket Pager — Brand identity

Product of **Aurexis**. Tagline: **طلبك جاهز في جيبك** ("your order, ready in your pocket").

## Logo
- **Mark:** a monoline pager with a check mark, a status dot and two signal waves. `svg/mark.svg` uses `currentColor`.
- **App tile:** the mark in white on the orange gradient tile (`svg/app-tile.svg`, corner radius 28%). This is the primary logo and the app icon.
- **Wordmark:** "Pocket Pager" in Readex Pro Bold, tracking −2%. The text is converted to outlines, so it needs no font.
  - On dark: "Pocket" in cloud and "Pager" in the amber gradient.
  - On light: "Pocket" in navy and "Pager" in the orange gradient.
  - On orange: "Pocket" in white and "Pager" in ink.
- **Lockups:**
  - `lockup-on-dark` and `lockup-on-light` are horizontal.
  - `stacked-*` adds the Arabic tagline and "POWERED BY AUREXIS". These two files keep live text in Readex Pro.
- **Clear space:** keep at least ¼ of the tile's height empty around the logo.
- **Minimum size:** 24 px for the tile and 16 px for the favicon. Use `favicon.svg` at small sizes, because it has a bigger mark.
- **Don't:**
  - recolour the mark (it's white on orange, or a single flat colour);
  - stretch, rotate or outline it;
  - put the tile on a busy photo;
  - use green for the brand. Green means "ready" only.

## Colour
| Token | Hex | Use |
|---|---|---|
| orange-500 | `#FF6A13` | Primary actions, brand moments |
| gradient | `#FFA024 → #FF6A13 → #EE4510` (145°) | Tile, hero areas, CTAs |
| amber | `#FFB020` | Highlight on dark backgrounds |
| navy | `#0D1324` | Dark surface, text on light backgrounds |
| night | `#070A14` | Deepest background |
| cream | `#FFF4E6` | Warm light surface |
| cloud / mist / slate / steel | `#F5F7FB` / `#C9D1E3` / `#9AA4B8` / `#5F6A82` | Text and UI greys |
| ink | `#1B1206` | Text on orange |
| ready | `#22D39A` | "Order ready" state only |

Proportions follow 60 / 30 / 10: navy or cream surfaces take 60%, neutrals 30%, orange 10%.

## Type
- **Readex Pro** is the only font family, for both Arabic and Latin. Weight 400 is for body text and 700 for headings and the wordmark. The font is already self-hosted in `server/public/fonts`.
- Arabic is the primary language, with RTL layout. "Pocket Pager", "QR" and "Aurexis" stay in Latin letters.

## Voice
Egyptian Arabic. Short, warm and direct. Example: «جرّبه 3 أيام ببلاش».

## Where the brand applies (and where it doesn't)
- **Pocket Pager identity:**
  - marketing and landing pages, `/demo` and `/super`;
  - the iOS app and App Clip icon, plus the Live Activity accents;
  - the favicon and PWA icons;
  - the default theme when a branch has no logo.
- **Aurexis:** a café's pages close with "Powered by" + the Aurexis mark + AUREXIS (`server/public/img/brand/aurexis-mark.svg`, self-hosted).
- **Café identity wins:**
  - a branch's customer, cashier and QR pages keep its own logo colour (the existing brand-colour system);
  - the branded cashier and owner apps stay private label, using the brand's own name and logo.

## Files
- `svg/`: master vector files. Regenerate them with `tools/build.py` (it needs Readex Pro 700 as a TTF).
- `png/ios/AppIcon-1024.png`: full-bleed, with no alpha channel (iOS rounds the corners itself).
- `png/android/`: legacy launcher icons for every density, adaptive foreground and background layers at 432 px, and the 512 px Play Store icon.
- `png/web/`: `favicon.ico` (16/32/48), `favicon.svg`, `apple-touch-icon-180`, `icon-192`, `icon-512`, and `icon-maskable-512`.
- `png/social/`: the 1200×630 OG image, a 1080 avatar, and 1200 square posts.
- `tokens.css`: CSS custom properties.
