#!/usr/bin/env bash
# The managers' Android app end to end on an emulator, against a local server with the review
# brand (CI: .github/workflows/play-build.yml). Screenshots go to $SHOTS.
#   e2e.sh <app.apk> <server base, e.g. http://127.0.0.1:3000> <work dir with su.txt>
set -euo pipefail
APK="$1"; BASE="$2"; WORK="$3"
P=cc.aurexis.pocketpager
mkdir -p "$SHOTS"

shot() { sleep "${2:-6}"; adb exec-out screencap -p > "$SHOTS/$1.png"; echo "shot $1"; }
start() { adb shell am force-stop $P; adb shell am start -n $P/.MainActivity "$@" > /dev/null; }
owner() { curl -fs -b "$WORK/owner.txt" -c "$WORK/owner.txt" -H 'content-type: application/json' "$@"; }

adb reverse tcp:3000 tcp:3000
adb install -r "$APK" > /dev/null
adb shell pm grant $P android.permission.POST_NOTIFICATIONS || true

start; shot 01-sign-in
start --es login 01099990001 --es password Review-ci-1; shot 02-branches 10
start --ei tab 1; shot 03-alerts
start --ei tab 2; shot 04-management 12
start --ei tab 3; shot 05-account
start --es branch review-cafe-maadi; shot 06-branch

# Stays signed in: the app closed and opened, then the phone restarted.
start; shot 07-reopened-still-signed-in
adb reboot
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
sleep 5
adb reverse tcp:3000 tcp:3000
start; shot 08-after-phone-restart-still-signed-in 10

# Live: two orders taken on the server show up while the app is open.
start; shot 09-live-before 8
curl -fs -c "$WORK/bar.txt" -H 'content-type: application/json' -d '{"shopId":"review-cafe-maadi","pin":"1234"}' "$BASE/api/bar/login" > /dev/null
K=$(curl -fs -b "$WORK/bar.txt" "$BASE/api/bar/review-cafe-maadi/state" | python3 -c 'import json,sys,urllib.parse as u; print(u.parse_qs(u.urlparse(json.load(sys.stdin)["qr"]["staticUrl"]).query)["k"][0])')
for i in 1 2; do
  curl -fs -H 'content-type: application/json' -H "x-client-id: ci-and-$i-xxxxxxxxxxxxxxxx" -d "{\"k\":\"$K\"}" "$BASE/api/b/review-cafe-maadi/claim" > /dev/null
done
shot 10-live-after-two-new-orders 12

# A notification: the owner pauses a branch on the website; the app shows it as an Android notification.
curl -fs -c "$WORK/owner.txt" -H 'content-type: application/json' -d '{"login":"01099990001","password":"Review-ci-1"}' "$BASE/api/login" > /dev/null
owner -d '{"paused":true}' "$BASE/api/brand/review-cafe/branches/review-cafe-zamalek/settings" > /dev/null
sleep 14
adb shell cmd statusbar expand-notifications
shot 11-notification 3
adb shell cmd statusbar collapse
owner -d '{"paused":false}' "$BASE/api/brand/review-cafe/branches/review-cafe-zamalek/settings" > /dev/null

# A branch manager: one branch only. Then the super stops the account: back to sign-in.
adb shell pm clear $P > /dev/null
adb shell pm grant $P android.permission.POST_NOTIFICATIONS || true
start --es login 01099990002 --es password Review-ci-1; shot 12-manager-one-branch 10
MID=$(curl -fs -b "$WORK/su.txt" "$BASE/api/super/overview" | python3 -c '
import json, sys
b = [x for x in json.load(sys.stdin)["brands"] if x["id"] == "review-cafe"][0]
print([o for o in b["owners"] if o["username"] == "01099990002"][0]["id"])')
curl -fs -b "$WORK/su.txt" -H 'content-type: application/json' -d '{"disabled":true}' "$BASE/api/super/owners/$MID/disable" > /dev/null
start; shot 13-stopped-account-back-to-sign-in 12
ls -la "$SHOTS"
