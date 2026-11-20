#!/usr/bin/env bash
# Builds Pocket Pager for Google Play: an Android App Bundle (.aab), signed with the upload key.
#
#   ANDROID_JAR=<sdk>/platforms/android-36/android.jar BUILD_TOOLS=<sdk>/build-tools/36.0.0 \
#   BUNDLETOOL=bundletool.jar KEYSTORE=upload.jks KEY_ALIAS=upload KEY_PASSWORD=... \
#   ./build.sh [out.aab]
#
# No Gradle (like apps/android): aapt2 in proto format, javac, D8, bundletool, jarsigner.
# Without KEYSTORE the bundle is signed with a throwaway key: fine for checks, not for upload.
# VERSION holds the version name; the version code comes from it (1.2.3 -> 10203).
# SERVER overrides the page the app opens (default https://pager.aurexis.cc), for tests.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/build/pocket-pager.aab}"
: "${ANDROID_JAR:?set ANDROID_JAR to platforms/android-36/android.jar}"
: "${BUILD_TOOLS:?set BUILD_TOOLS to build-tools/36.x}"
: "${BUNDLETOOL:?set BUNDLETOOL to bundletool-all-<version>.jar}"
VERSION_NAME="$(cat "$HERE/VERSION")"
VERSION_CODE="$(echo "$VERSION_NAME" | awk -F. '{ print $1 * 10000 + $2 * 100 + $3 }')"
PY=python3; "$PY" -c "" 2>/dev/null || PY=python

B="$HERE/build/work"
rm -rf "$B"
mkdir -p "$B/gen" "$B/classes" "$B/dex" "$B/res-src" "$(dirname "$OUT")"
cp -r "$HERE/res/." "$B/res-src/"
if [ -n "${SERVER:-}" ]; then
  sed -i.bak "s#https://pager.aurexis.cc#${SERVER}#" "$B/res-src/values/strings.xml" && rm -f "$B/res-src/values/strings.xml.bak"
fi

"$BUILD_TOOLS/aapt2" compile --dir "$B/res-src" -o "$B/res.zip"
"$BUILD_TOOLS/aapt2" link --proto-format -o "$B/base.apk" -I "$ANDROID_JAR" --manifest "$HERE/AndroidManifest.xml" \
  --java "$B/gen" --min-sdk-version 24 --target-sdk-version 36 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$B/res.zip"

BOOT="$ANDROID_JAR:$BUILD_TOOLS/core-lambda-stubs.jar"
if command -v cygpath >/dev/null; then BOOT="$(cygpath -w "$ANDROID_JAR");$(cygpath -w "$BUILD_TOOLS/core-lambda-stubs.jar")"; fi
mapfile -t SOURCES < <(find "$HERE/src" "$B/gen" -name '*.java')
javac -source 8 -target 8 -Xlint:-options -encoding UTF-8 -bootclasspath "$BOOT" -d "$B/classes" "${SOURCES[@]}"
mapfile -t CLASSES < <(find "$B/classes" -name '*.class')
java -cp "$BUILD_TOOLS/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 24 --lib "$ANDROID_JAR" \
  --output "$B/dex" "${CLASSES[@]}"

# The base module: manifest/, dex/, res/, resources.pb (bundletool's layout).
"$PY" - "$B/base.apk" "$B/dex/classes.dex" "$B/base.zip" <<'PY'
import sys, zipfile
apk, dex, out = sys.argv[1:]
with zipfile.ZipFile(apk) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
    for item in src.infolist():
        name = item.filename
        target = 'manifest/AndroidManifest.xml' if name == 'AndroidManifest.xml' else name
        dst.writestr(target, src.read(name))
    dst.write(dex, 'dex/classes.dex')
PY

rm -f "$OUT"
java -jar "$BUNDLETOOL" build-bundle --modules="$B/base.zip" --output="$OUT"

if [ -z "${KEYSTORE:-}" ]; then
  echo "No KEYSTORE: signing with a throwaway key (checks only, not for Google Play)" >&2
  KEYSTORE="$B/throwaway.jks"; KEY_ALIAS=throwaway; KEY_PASSWORD=throwaway
  keytool -genkeypair -keystore "$KEYSTORE" -alias "$KEY_ALIAS" -storepass "$KEY_PASSWORD" -keypass "$KEY_PASSWORD" \
    -keyalg RSA -keysize 2048 -validity 1 -dname "CN=throwaway" >/dev/null 2>&1
fi
jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore "$KEYSTORE" -storepass "$KEY_PASSWORD" -keypass "$KEY_PASSWORD" \
  "$OUT" "${KEY_ALIAS:-upload}" >/dev/null
java -jar "$BUNDLETOOL" validate --bundle="$OUT" >/dev/null
echo "Built $OUT ($VERSION_NAME, code $VERSION_CODE)"
