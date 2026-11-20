# App Clip + Live Activity: why it doesn't open, and the fix

**Symptom (real iPhone, Nov 2026).** The customer scans the QR. The Lock Screen then shows a **Now Playing** player («طلبك رقم 1 / طلبك قيد التحضير», play, ±10 s), not a Live Activity. That player comes from the web page's alarm stream (Media Session). It means the QR opened **Safari, not the App Clip**.

## What was checked (2026-11-20)

| # | Check | Result |
|---|---|---|
| 6a | `https://pager.aurexis.cc/.well-known/apple-app-site-association` | ✅ `appclips.apps = ["MZ737V7Y46.cc.aurexis.pager.Clip"]`; `applinks` `/s/*` for `MZ737V7Y46.cc.aurexis.pager` |
| 6b | Apple's CDN copy (`app-site-association.cdn-apple.com/a/v1/pager.aurexis.cc`) | ✅ identical |
| 6c | Smart banner on `/s/<branch>` | ✅ `app-id=6826356075, app-clip-bundle-id=cc.aurexis.pager.Clip, app-clip-display=card` |
| 6d | **Advanced App Clip Experience for `https://pager.aurexis.cc/s/`** | ❌ **never registered** in App Store Connect (pending since 2026-10-27) |
| 1 | APNs host | ✅ production (`APNS_ENV=production`, `api.push.apple.com`) |
| 2 | APNs topic | ✅ `cc.aurexis.pager.Clip.push-type.liveactivity` for the Clip, `cc.aurexis.pager.push-type.liveactivity` for the app (server/src/notify/index.js); `apns-push-type: liveactivity`; priority 10; `content-state` = `PagerAttributes.ContentState` |
| 3 | Widget embedded in the Clip | ✅ `PocketPagerClip` depends on `PocketPagerClipWidget` (project.yml) |
| 4 | `NSSupportsLiveActivities` | ✅ in the app's and the Clip's Info.plist, every configuration |
| 5 | `aps-environment` | ⚠ `development` in the source entitlements. App Store export replaces it from the distribution profile with `production`. Confirm on the exported .ipa (see below) |

## The cause

Item **6d**. The camera opens an App Clip only when a URL matches an **Advanced App Clip Experience**. A default experience covers only Apple's own `appclip.apple.com` links and the Safari banner, which needs one more tap. Our QR codes point to `https://pager.aurexis.cc/s/<branch>?n=…`, so iOS opens Safari, and the page's audio player is what shows on the Lock Screen.

## The fix (App Store Connect, the account that owns the app)

1. App Store Connect → Pocket Pager → the version on sale → **App Clip** section: the build includes the App Clip.
2. App Store Connect → Pocket Pager → **App Clip Experiences** → **Advanced App Clip Experiences** → **+**:
   - URL: `https://pager.aurexis.cc/s/`. It's a prefix, so every branch link under it matches.
   - Action: **Open**.
   - Title: «طلبك جاهز في جيبك». Subtitle: «تابع رقم طلبك وموبايلك هيرن لما يجهز».
   - Image: 3000×2000 (the brand header image).
   - Place association: optional.
3. Wait for the status to read **Received** and then **Approved**. It usually takes a few hours.
4. Test by scanning a branch QR with the iPhone Camera. The App Clip card should appear, not Safari.
5. Confirm the export (item 5) once, on any Mac:
   ```
   codesign -d --entitlements - "Payload/PocketPager.app/AppClips/PocketPagerClip.app"
   ```
   The output must say `aps-environment = production`.

## What stays

The web page's alarm stream and Media Session stay as they are. They are the path on Android, and on iPhones where the App Clip doesn't open.
