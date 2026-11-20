#!/usr/bin/env bash
# Prepares a fresh Debian or Ubuntu VPS for Ligo (design doc section 13), once, as root:
#   - Docker and its Compose plugin, from Docker's own packages;
#   - the `ligo` user (uid 1000, the containers' user), allowed to use Docker, with root's SSH keys;
#   - /opt/ligo (the clone of the repository) and /srv/ligo/data (the database and the files);
#   - a firewall open on 22, 80 and 443 only; SSH by key only; automatic security upgrades;
#   - the nightly copy of the files to R2 (deploy/backup-storage.sh), as a systemd timer.
# Running it again changes nothing that is already in place.
#
#   curl -fsSL https://raw.githubusercontent.com/Ligo-League/ligo/main/deploy/setup-vps.sh -o setup-vps.sh
#   less setup-vps.sh && bash setup-vps.sh
set -euo pipefail

REPO=https://github.com/Ligo-League/ligo.git
APP_DIR=/opt/ligo
DATA_DIR=/srv/ligo/data

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
case "$ID" in debian | ubuntu) ;; *) echo "Debian or Ubuntu only, not $ID." >&2; exit 1 ;; esac

# Password logins go away below: a key must be in place first, or nobody gets back in.
if ! grep -qE '^(ssh|ecdsa|sk)-' /root/.ssh/authorized_keys 2>/dev/null; then
  echo "No SSH key in /root/.ssh/authorized_keys: add yours first (ssh-copy-id root@<vps>)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw unattended-upgrades sqlite3

# Docker, from download.docker.com (https://docs.docker.com/engine/install/).
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# The ligo user owns the clone and the data with the containers' uid, so files match on both sides.
if ! id ligo >/dev/null 2>&1; then
  if getent passwd 1000 >/dev/null; then
    echo "uid 1000 is taken by $(getent passwd 1000 | cut -d: -f1); the containers run as 1000." >&2
    exit 1
  fi
  useradd --create-home --uid 1000 --shell /bin/bash ligo
fi
usermod -aG docker ligo
install -d -m 700 -o ligo -g ligo /home/ligo/.ssh
install -m 600 -o ligo -g ligo /root/.ssh/authorized_keys /home/ligo/.ssh/authorized_keys

install -d -o ligo -g ligo "$APP_DIR" /srv/ligo "$DATA_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  runuser -u ligo -- git clone "$REPO" "$APP_DIR"
fi

# Firewall. Docker publishes 80 and 443 itself (Caddy); the server has no published port.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# SSH by key only.
cat >/etc/ssh/sshd_config.d/10-ligo.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd

# Security upgrades every day.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# The nightly copy of the files to R2, at 03:30 Paris time.
cat >/etc/systemd/system/ligo-backup-files.service <<EOF
[Unit]
Description=Copy Ligo's files to R2 (deploy/backup-storage.sh)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=ligo
ExecStart=$APP_DIR/deploy/backup-storage.sh
EOF
cat >/etc/systemd/system/ligo-backup-files.timer <<'EOF'
[Unit]
Description=Copy Ligo's files to R2 each night

[Timer]
OnCalendar=*-*-* 03:30 Europe/Paris
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now ligo-backup-files.timer

echo
echo "Done. Next, as ligo (ssh ligo@<vps>): create $APP_DIR/deploy/.env from .env.example,"
echo "then $APP_DIR/deploy/update.sh (docs/setup.md section 56)."
