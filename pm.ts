#!/bin/bash

set -e

# ======== CONFIG ========
IPA_INPUT="$1"
CERT_NAME="iPhone Developer: Your Name (XXXXXXXXXX)"
PROVISION_PROFILE="dev.mobileprovision"
OUTPUT_IPA="Resigned-$IPA_INPUT"
TMP_DIR="resign_tmp"
ENTITLEMENTS_FILE="entitlements.plist"
# =========================

if [[ -z "$IPA_INPUT" ]]; then
  echo "Usage: $0 path/to/app.ipa"
  exit 1
fi

# Clean
rm -rf "$TMP_DIR" "$OUTPUT_IPA" "$ENTITLEMENTS_FILE"
mkdir -p "$TMP_DIR"

# Unpack IPA
echo "[*] Unpacking IPA..."
unzip -q "$IPA_INPUT" -d "$TMP_DIR"

APP_PATH=$(find "$TMP_DIR/Payload" -name "*.app" | head -n 1)
APP_BINARY=$(plutil -extract CFBundleExecutable xml1 -o - "$APP_PATH/Info.plist" | grep -A1 "<string>" | tail -n1 | sed -E 's/.*<string>(.*)<\/string>.*/\1/')

echo "[*] Found app: $APP_PATH"
echo "[*] Replacing provisioning profile..."
cp "$PROVISION_PROFILE" "$APP_PATH/embedded.mobileprovision"

# Extract team ID and bundle ID from provisioning profile
echo "[*] Extracting team ID..."
TEAM_ID=$(security cms -D -i "$PROVISION_PROFILE" | plutil -extract TeamIdentifier raw -o - -)
APP_ID=""

# Extract entitlements (original)
echo "[*] Extracting entitlements..."
codesign -d --entitlements :- "$APP_PATH" > full-entitlements.plist 2>/dev/null || true

# Generate safe entitlements
cat > "$ENTITLEMENTS_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>application-identifier</key>
  <string>$TEAM_ID.*</string>
  <key>get-task-allow</key>
  <true/>
</dict>
</plist>
EOF

# Resign frameworks (if any)
echo "[*] Resigning embedded frameworks..."
find "$APP_PATH/Frameworks" -type f -name "*.dylib" -or -name "*.framework" | while read framework; do
  codesign -f -s "$CERT_NAME" --preserve-metadata=identifier,flags "$framework"
done

# Resign app
echo "[*] Resigning app binary..."
codesign -f -s "$CERT_NAME" --entitlements "$ENTITLEMENTS_FILE" "$APP_PATH"

# Validate
echo "[*] Verifying signature..."
codesign -v "$APP_PATH" && echo "[+] Resign successful"

# Repackage
echo "[*] Creating resigned IPA..."
cd "$TMP_DIR"
zip -qr "../$OUTPUT_IPA" Payload
cd ..

echo "[+] Done. Output: $OUTPUT_IPA"