#!/usr/bin/env bash
# Builds the HSK 4 Prep Android app (a sideloadable APK) without Gradle, straight from the SDK tools.
#
#   ./build-apk.sh            release APK  -> ../server/downloads/hsk4-prep.apk (+ copy on the Desktop)
#   ./build-apk.sh --debug    test APK with WebView debugging on -> build/hsk4-prep-debug.apk
#
# Bump VERSION_CODE (whole number) and VERSION_NAME for every release you hand out,
# otherwise phones won't offer the new file as an update.
set -euo pipefail
VERSION_CODE=2
VERSION_NAME=1.1
MIN_SDK=24
TARGET_SDK=36

cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/36.1.0"
PLATFORM="$SDK/platforms/android-36/android.jar"
export JAVA_HOME="$(brew --prefix openjdk@17)"
export PATH="$JAVA_HOME/bin:$PATH"
KEYSTORE="$HOME/Desktop/HSK4-App-Signing/hsk4-release.jks"
KEYPASS="$HOME/Desktop/HSK4-App-Signing/keystore-password.txt"
[ -f "$KEYSTORE" ] || { echo "Signing key not found at $KEYSTORE" >&2; exit 1; }

DEBUG=0; [ "${1:-}" = "--debug" ] && DEBUG=1
rm -rf build && mkdir -p build/gen build/classes build/dex

"$BT/aapt2" compile --dir res -o build/res.zip
LINK_FLAGS=()
[ $DEBUG = 1 ] && LINK_FLAGS+=(--debug-mode)
"$BT/aapt2" link -o build/app-unsigned.apk -I "$PLATFORM" \
  --manifest AndroidManifest.xml --java build/gen build/res.zip \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code $VERSION_CODE --version-name $VERSION_NAME ${LINK_FLAGS[@]+"${LINK_FLAGS[@]}"}

javac --release 11 -Xlint:-options -nowarn -encoding UTF-8 -classpath "$PLATFORM" -d build/classes \
  $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api $MIN_SDK --lib "$PLATFORM" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -j ../app-unsigned.apk classes.dex)

"$BT/zipalign" -p -f 4 build/app-unsigned.apk build/app-aligned.apk
if [ $DEBUG = 1 ]; then OUT=build/hsk4-prep-debug.apk; else OUT=build/hsk4-prep.apk; fi
# </dev/null: apksigner otherwise blocks waiting on stdin when run from a non-interactive shell.
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias hsk4 --ks-pass "file:$KEYPASS" \
  --min-sdk-version $MIN_SDK --out "$OUT" build/app-aligned.apk < /dev/null
"$BT/apksigner" verify --min-sdk-version $MIN_SDK "$OUT" < /dev/null

if [ $DEBUG = 0 ]; then
  mkdir -p ../server/downloads
  cp "$OUT" ../server/downloads/hsk4-prep.apk
  cp "$OUT" "$HOME/Desktop/HSK4-Prep-$VERSION_NAME.apk"
  echo "release $VERSION_NAME ($VERSION_CODE): server/downloads/hsk4-prep.apk and ~/Desktop/HSK4-Prep-$VERSION_NAME.apk ($(du -k "$OUT" | cut -f1) KB)"
else
  echo "test build: android/$OUT"
fi
