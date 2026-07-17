#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT_DIR/.hydro-batter-runtime"
NODE_MODULES_DIR="$ROOT_DIR/node_modules"
DRY_RUN=0
KEEP_NODE_MODULES=0

log() { printf '\033[1;32m[hydro-batter]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[hydro-batter]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage: ./uninstall.sh [options]

Remove only the project-local files created by install.sh on Linux. This does
not unregister the Hydro addon, stop/restart PM2, modify a Nix profile, run Nix
garbage collection, or delete browser-local drafts.

Removed by default:
  .hydro-batter-runtime  Nix GC roots, command links, JDT LS and download cache
  node_modules           Pyright and Tree-sitter npm dependencies

Options:
  --dry-run            Print what would be removed without changing files
  --keep-node-modules  Keep node_modules and remove only the native runtime
  -h, --help           Show this help
EOF
}

while (($#)); do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --keep-node-modules) KEEP_NODE_MODULES=1 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "Unknown option: $1" ;;
    esac
    shift
done

[[ "$(uname -s)" == Linux ]] || die "Only Linux + PM2 + Nix deployments are supported."
[[ "$ROOT_DIR" != / ]] || die "Refusing to uninstall from the filesystem root."
[[ "$RUNTIME_DIR" == "$ROOT_DIR/.hydro-batter-runtime" ]] || die "Unexpected runtime path."
[[ "$NODE_MODULES_DIR" == "$ROOT_DIR/node_modules" ]] || die "Unexpected node_modules path."
[[ -f "$ROOT_DIR/package.json" ]] || die "package.json was not found beside uninstall.sh."
grep -Eq '"name"[[:space:]]*:[[:space:]]*"hydro-batter-code-edit"' "$ROOT_DIR/package.json" \
    || die "This directory is not the Hydro Batter Code Edit package."

remove_owned_path() {
    local path="$1" label="$2"
    if [[ ! -e "$path" && ! -L "$path" ]]; then
        log "$label is already absent: $path"
        return
    fi
    if ((DRY_RUN)); then
        log "Would remove $label: $path"
    else
        rm -rf -- "$path"
        log "Removed $label: $path"
    fi
}

remove_owned_path "$RUNTIME_DIR" "plugin runtime"
if ((KEEP_NODE_MODULES)); then
    log "Keeping npm dependencies: $NODE_MODULES_DIR"
else
    remove_owned_path "$NODE_MODULES_DIR" "npm dependencies"
fi

if ((DRY_RUN)); then
    log "Dry run complete; no files were changed."
else
    log "Project-local dependencies were removed. Disable/unregister the addon separately, then restart the existing Hydro PM2 process."
    log "Nix store garbage collection was intentionally not run."
fi
