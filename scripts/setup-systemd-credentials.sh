#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="openclaw"
SERVICE_ACCOUNT=""
SECRET_FILE="/etc/openclaw/secrets/protonmail_bridge_password"
SKIP_RESTART="false"

print_usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/setup-systemd-credentials.sh --account <protonmail-account> [options]

Required:
  --account <email>           ProtonMail account email (for PROTONMAIL_ACCOUNT)

Options:
  --service <name>            systemd service name (default: openclaw)
  --user <name>               Service user/group owner for secret file
  --secret-file <path>        Secret file path (default: /etc/openclaw/secrets/protonmail_bridge_password)
  --skip-restart              Do not restart the systemd service
  --help                      Show this help

What this script does:
  1) Prompts for Proton Bridge password securely (no terminal echo)
  2) Writes it to a root-owned file with mode 600
  3) Creates a systemd override with:
       - Environment=PROTONMAIL_ACCOUNT=...
       - LoadCredential=protonmail_bridge_password:<secret-file>
  4) Runs daemon-reload and optionally restarts the service
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account)
      SERVICE_ACCOUNT="${2:-}"
      shift 2
      ;;
    --service)
      SERVICE_NAME="${2:-}"
      shift 2
      ;;
    --user)
      SERVICE_USER="${2:-}"
      shift 2
      ;;
    --secret-file)
      SECRET_FILE="${2:-}"
      shift 2
      ;;
    --skip-restart)
      SKIP_RESTART="true"
      shift
      ;;
    --help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage
      exit 1
      ;;
  esac
done

if [[ -z "$SERVICE_ACCOUNT" ]]; then
  echo "Error: --account is required." >&2
  print_usage
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Error: run this script as root (use sudo)." >&2
  exit 1
fi

if ! systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
  echo "Error: ${SERVICE_NAME}.service not found." >&2
  echo "Tip: pass --service <name> if your unit name differs." >&2
  exit 1
fi

if [[ -z "${SERVICE_USER:-}" ]]; then
  SERVICE_USER="$(systemctl show -p User --value "${SERVICE_NAME}.service" || true)"
fi

if [[ -z "$SERVICE_USER" ]]; then
  SERVICE_USER="root"
fi

read -r -s -p "Enter Proton Bridge password for ${SERVICE_ACCOUNT}: " BRIDGE_PASSWORD
echo

if [[ -z "$BRIDGE_PASSWORD" ]]; then
  echo "Error: password cannot be empty." >&2
  exit 1
fi

SECRET_DIR="$(dirname "$SECRET_FILE")"
install -d -m 700 "$SECRET_DIR"
umask 077
printf '%s\n' "$BRIDGE_PASSWORD" > "$SECRET_FILE"
unset BRIDGE_PASSWORD

chown "$SERVICE_USER:$SERVICE_USER" "$SECRET_FILE" || true
chmod 600 "$SECRET_FILE"

OVERRIDE_DIR="/etc/systemd/system/${SERVICE_NAME}.service.d"
OVERRIDE_FILE="${OVERRIDE_DIR}/protonmail-credentials.conf"

install -d -m 755 "$OVERRIDE_DIR"

cat > "$OVERRIDE_FILE" <<EOF
[Service]
Environment=PROTONMAIL_ACCOUNT=${SERVICE_ACCOUNT}
LoadCredential=protonmail_bridge_password:${SECRET_FILE}
EOF

chmod 644 "$OVERRIDE_FILE"

systemctl daemon-reload

if [[ "$SKIP_RESTART" == "true" ]]; then
  echo "Setup complete. Restart ${SERVICE_NAME}.service manually when ready."
else
  systemctl restart "${SERVICE_NAME}.service"
  echo "Setup complete and ${SERVICE_NAME}.service restarted."
fi

echo
echo "Credential source now uses: CREDENTIALS_DIRECTORY/protonmail_bridge_password"
echo "Secret file path: ${SECRET_FILE}"
