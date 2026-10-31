#!/bin/sh
# Makes the key that signs Kooks for Android, once, on your own computer.
#
# Every Android release must be signed with the same key, or phones refuse to
# install it over the one they have. This script makes that key, keeps it in
# a folder only you can read, and gives it to GitHub as two Actions secrets
# for the Phone release workflow (docs/native-app.md). The key never needs to
# leave your computer and GitHub. Keep the folder: it is the only copy
# outside GitHub, and GitHub never shows a secret again.
#
# Needs: openssl (macOS and Linux have it; on Windows use Git Bash). With the
# GitHub CLI (gh) signed in, it stores the secrets for you; otherwise it says
# what to paste where.
#
#   sh scripts/android-release-key.sh [folder]
#
# The folder defaults to ~/kooks-android-release. The script stops if a key is
# already there, so it never replaces the key your phones already trust.

set -eu

dir=${1:-"$HOME/kooks-android-release"}
repo=${KOOKS_REPO:-}
if [ -z "$repo" ]; then
  url=$(git remote get-url origin 2>/dev/null || true)
  repo=$(printf '%s\n' "$url" |
    sed -n 's#^.*github\.com[:/]\([^/]*/[^/]*\)$#\1#p' | sed 's#\.git$##')
  repo=${repo:-Sweatpantslife/kooks}
fi
keystore="$dir/kooks-release.p12"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is missing. Install it (on Windows, run this in Git Bash) and try again." >&2
  exit 1
fi
if [ -e "$keystore" ]; then
  echo "There is already a key at $keystore." >&2
  echo "Phones only install releases signed with the key they have, so this script won't replace it." >&2
  echo "To store it in GitHub again, see docs/native-app.md (Android releases)." >&2
  exit 1
fi

umask 077
mkdir -p "$dir"
work=$(mktemp -d "${TMPDIR:-/tmp}/kooks-key.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM

# 32 characters from a-z, A-Z and 0-9: easy to paste, nothing to escape.
password=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)
KOOKS_KEY_PASSWORD=$password
export KOOKS_KEY_PASSWORD

echo "Making a 4096-bit RSA key, valid for 30 years…"
openssl req -x509 -newkey rsa:4096 -sha256 -days 10950 -nodes \
  -subj "/CN=Kooks/O=Kooks household" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
openssl pkcs12 -export -name kooks \
  -inkey "$work/key.pem" -in "$work/cert.pem" \
  -passout env:KOOKS_KEY_PASSWORD -out "$keystore"
cp "$work/cert.pem" "$dir/kooks-release-certificate.pem"
printf '%s\n' "$password" >"$dir/password.txt"
openssl base64 -A -in "$keystore" >"$dir/keystore.base64.txt"
fingerprint=$(openssl x509 -in "$work/cert.pem" -noout -fingerprint -sha256 |
  sed 's/^.*=//')
cat >"$dir/README.txt" <<EOF
Kooks Android release key, made $(date -u +%Y-%m-%d).

kooks-release.p12                 the key (PKCS #12, alias "kooks")
password.txt                      its password
keystore.base64.txt               the key as text, for the GitHub secret
kooks-release-certificate.pem     the public certificate

GitHub repository: $repo
Secrets: KOOKS_ANDROID_KEYSTORE (keystore.base64.txt) and
         KOOKS_ANDROID_KEYSTORE_PASSWORD (password.txt)
Certificate SHA-256: $fingerprint

Keep this folder, or a copy of kooks-release.p12 and its password, somewhere
safe such as a password manager. Releases signed with another key can't be
installed over the app on your phones: they would have to uninstall it and
sign in again. The recipes live in the kitchen, so nothing else is lost.
EOF

echo
echo "The key is in $dir"
echo "Its certificate's SHA-256 fingerprint, which every release page shows too:"
echo "  $fingerprint"
echo

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  printf 'Store it in %s as Actions secrets now, with the GitHub CLI? [y/N] ' "$repo"
  read -r answer || answer=
  case "$answer" in
  [yY]*)
    gh secret set KOOKS_ANDROID_KEYSTORE --repo "$repo" <"$dir/keystore.base64.txt"
    gh secret set KOOKS_ANDROID_KEYSTORE_PASSWORD --repo "$repo" <"$dir/password.txt"
    echo "Done. Run the Phone release workflow from the repository's Actions tab."
    exit 0
    ;;
  esac
fi

cat <<EOF
Now give GitHub the key, as two repository secrets:

  1. Open https://github.com/$repo/settings/secrets/actions/new
  2. Name: KOOKS_ANDROID_KEYSTORE
     Secret: everything in $dir/keystore.base64.txt
     (on a Mac, "pbcopy < $dir/keystore.base64.txt" puts it on the clipboard)
  3. Add another. Name: KOOKS_ANDROID_KEYSTORE_PASSWORD
     Secret: the line in $dir/password.txt

Then run the Phone release workflow from the repository's Actions tab.
EOF
