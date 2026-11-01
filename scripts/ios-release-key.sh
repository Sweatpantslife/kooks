#!/bin/sh
# Gives GitHub what the Phone release workflow needs to put Kooks on
# TestFlight, once, on your own computer (docs/native-app.md, iPhone).
#
# You bring the App Store Connect API key you downloaded (AuthKey_<id>.p8)
# and the Issuer ID shown above the list of keys. The script makes the key
# that Kooks' Apple Distribution certificate is built on, keeps everything in
# a folder only you can read, and stores four Actions secrets. The workflow
# creates the certificate and provisioning profile from them through Apple's
# API, so neither key ever needs to pass through anything but your computer
# and GitHub.
#
# Needs: openssl (macOS and Linux have it; on Windows use Git Bash). With the
# GitHub CLI (gh) signed in, it stores the secrets for you; otherwise it says
# what to paste where.
#
#   sh scripts/ios-release-key.sh ~/Downloads/AuthKey_XXXXXXXXXX.p8 [issuer-id] [folder]
#
# The folder defaults to ~/kooks-ios-release. Run it again with a new API key
# and it keeps the certificate key already there, so the certificate stays.

set -eu

p8=${1:-}
issuer=${2:-}
dir=${3:-"$HOME/kooks-ios-release"}
repo=${KOOKS_REPO:-}
if [ -z "$repo" ]; then
  url=$(git -C "$(dirname "$0")" remote get-url origin 2>/dev/null || true)
  repo=$(printf '%s\n' "$url" |
    sed -n 's#^.*github\.com[:/]\([^/]*/[^/]*\)$#\1#p' | sed 's#\.git$##')
  repo=${repo:-Sweatpantslife/kooks}
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is missing. Install it (on Windows, run this in Git Bash) and try again." >&2
  exit 1
fi
if [ -z "$p8" ] || [ ! -f "$p8" ]; then
  echo "Usage: sh scripts/ios-release-key.sh ~/Downloads/AuthKey_XXXXXXXXXX.p8 [issuer-id]" >&2
  echo "Download the API key from App Store Connect › Users and Access › Integrations first." >&2
  exit 1
fi
if ! grep -q -- '-----BEGIN PRIVATE KEY-----' "$p8"; then
  echo "$p8 doesn't look like an App Store Connect API key (.p8)." >&2
  exit 1
fi
key_id=$(basename "$p8" | sed -n 's/^AuthKey_\([A-Za-z0-9]*\)\.p8$/\1/p')
if [ -z "$key_id" ]; then
  printf 'Key ID (shown beside the key in App Store Connect): '
  read -r key_id </dev/tty
fi
if [ -z "$issuer" ]; then
  printf 'Issuer ID (shown above the list of keys in App Store Connect): '
  read -r issuer </dev/tty
fi
if ! printf '%s\n' "$issuer" | grep -Eq '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'; then
  echo "\"$issuer\" isn't an Issuer ID; it looks like 69a6de70-03db-47e3-e053-5b8c7c11a4d1." >&2
  exit 1
fi

umask 077
mkdir -p "$dir"
cp "$p8" "$dir/AuthKey_$key_id.p8"
printf '%s\n' "$issuer" >"$dir/issuer-id.txt"
printf '%s\n' "$key_id" >"$dir/key-id.txt"
certificate_key="$dir/certificate-key.pem"
if [ -e "$certificate_key" ]; then
  echo "Keeping the certificate key already in $dir."
else
  echo "Making the 2048-bit RSA key for the Apple Distribution certificate…"
  openssl genrsa -out "$certificate_key" 2048 2>/dev/null
fi
cat >"$dir/README.txt" <<EOF
Kooks iPhone release keys, last stored $(date -u +%Y-%m-%d).

- AuthKey_$key_id.p8: the App Store Connect API key
- issuer-id.txt and key-id.txt: its Issuer ID and Key ID
- certificate-key.pem: the key Kooks' Apple Distribution certificate is made from

GitHub repository: $repo
Secrets: APP_STORE_CONNECT_ISSUER_ID     (issuer-id.txt)
         APP_STORE_CONNECT_KEY_ID        (key-id.txt)
         APP_STORE_CONNECT_PRIVATE_KEY   (AuthKey_$key_id.p8)
         KOOKS_IOS_CERTIFICATE_KEY       (certificate-key.pem)

Keep this folder somewhere safe, such as a password manager. If the
certificate key is lost, nothing on the iPhone breaks: the next release makes
a new certificate (the old one can be revoked in Certificates, Identifiers &
Profiles). If the API key leaks, revoke it in App Store Connect and run the
script again with a new one.
EOF

echo
echo "The keys are in $dir"
echo

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  printf 'Store them in %s as Actions secrets now, with the GitHub CLI? [y/N] ' "$repo"
  read -r answer </dev/tty || answer=
  case "$answer" in
  [yY]*)
    gh secret set APP_STORE_CONNECT_ISSUER_ID --repo "$repo" <"$dir/issuer-id.txt"
    gh secret set APP_STORE_CONNECT_KEY_ID --repo "$repo" <"$dir/key-id.txt"
    gh secret set APP_STORE_CONNECT_PRIVATE_KEY --repo "$repo" <"$dir/AuthKey_$key_id.p8"
    gh secret set KOOKS_IOS_CERTIFICATE_KEY --repo "$repo" <"$certificate_key"
    echo "Done. The next Phone release also sends Kooks to TestFlight."
    exit 0
    ;;
  esac
fi

cat <<EOF
Now give GitHub the keys, as four repository secrets. For each one, open
https://github.com/$repo/settings/secrets/actions/new
and paste the whole file, including any BEGIN and END lines
(on a Mac, "pbcopy < file" puts a file on the clipboard):

  APP_STORE_CONNECT_ISSUER_ID     $dir/issuer-id.txt
  APP_STORE_CONNECT_KEY_ID        $dir/key-id.txt
  APP_STORE_CONNECT_PRIVATE_KEY   $dir/AuthKey_$key_id.p8
  KOOKS_IOS_CERTIFICATE_KEY       $dir/certificate-key.pem

The next Phone release then also sends Kooks to TestFlight.
EOF
