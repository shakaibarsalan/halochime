#!/usr/bin/env bash
# Nightly off-server backup of Halochime: database dump + server config (env files, compose, TLS
# certs) -> one AES-256 encrypted file -> committed to the private GitHub repo halochime-backups.
# Pushes with a deploy key that can only write to that one repo; the repo holds only the last 30 days.
# No secrets in this file.
#
# Server setup (once): ~/.halochime-backup-pass (the encryption passphrase, chmod 600; a copy lives in
# the git-ignored deploy/.env.production on the owner's laptop), ~/.ssh/halochime_backup_ed25519 (deploy
# key), a clone of the backup repo in ~/talkfront-backups, and the cron line
#   30 4 * * * /home/ubuntu/talkfront/backup.sh >> /home/ubuntu/talkfront/backup.log 2>&1
# Restore: see deploy/README.md, "Backups".
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR=/home/ubuntu/talkfront
REPO_DIR=/home/ubuntu/talkfront-backups
PASSFILE=/home/ubuntu/.halochime-backup-pass
KEEP_DAYS=30
STAMP=$(date -u +%Y%m%d-%H%M%S)
export GIT_SSH_COMMAND="ssh -i /home/ubuntu/.ssh/halochime_backup_ed25519 -o IdentitiesOnly=yes"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "backup start ($STAMP)"

# 1) Database, custom format (compressed; restore with pg_restore). The password never leaves the container.
docker exec talkfront-db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -h 127.0.0.1 -d "$POSTGRES_DB" -Fc' \
  > "$WORK/talkfront.dump"
[ -s "$WORK/talkfront.dump" ] || { log "FAIL: empty database dump"; exit 1; }
log "  database dumped ($(du -h "$WORK/talkfront.dump" | cut -f1))"

# 2) Server config that is not in git.
mkdir "$WORK/config"
cp "$APP_DIR"/*.env "$APP_DIR/docker-compose.yml" "$APP_DIR/pg_hba.conf" "$WORK/config/" 2>/dev/null || true
# The DB's TLS key belongs to the postgres user, so copy the certs with (passwordless) sudo.
if [ -d "$APP_DIR/certs" ]; then
  sudo -n cp -r "$APP_DIR/certs" "$WORK/config/certs"
  sudo -n chown -R "$(id -u):$(id -g)" "$WORK/config/certs"
fi

# 3) Bundle and encrypt.
OUT="$REPO_DIR/halochime-$STAMP.tar.gz.enc"
tar czf "$WORK/bundle.tar.gz" -C "$WORK" talkfront.dump config
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$WORK/bundle.tar.gz" -out "$OUT" -pass file:"$PASSFILE"
log "  encrypted -> $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"

# 4) Keep only the newest KEEP_DAYS days (the Privacy Policy promises 30).
find "$REPO_DIR" -maxdepth 1 -name 'halochime-*.tar.gz.enc' -mtime +"$KEEP_DAYS" -delete

# 5) Replace the repo's history with one commit holding just these files, so expired backups are
#    gone from GitHub too. Only the new file is uploaded; the others are already there.
cd "$REPO_DIR"
git checkout -q --orphan next
git add -A
git commit -q -m "Backups up to $STAMP"
git branch -q -D main 2>/dev/null || true
git branch -q -m main
git push -q --force origin main
log "  pushed to GitHub ($(git rev-parse --short HEAD)); $(ls -1 halochime-*.tar.gz.enc | wc -l) backups in the repo"
