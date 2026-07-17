#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT_DIR/.hydro-batter-runtime"
RUNTIME_BIN="$RUNTIME_DIR/bin"
JDTLS_VERSION="${JDTLS_VERSION:-1.60.0}"
CHECK_ONLY=0
INSTALL_DEV=0
INSTALL_SYSTEM=0
USE_NIX=1
SKIP_JDTLS=0
TEMP_DIRS=("")

log() { printf '\033[1;32m[hydro-batter]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[hydro-batter]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[hydro-batter]\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

cleanup_temp_dirs() {
    local directory
    for directory in "${TEMP_DIRS[@]}"; do
        if [[ -n "$directory" && "$directory" == *hydro-batter-* ]]; then
            rm -rf -- "$directory"
        fi
    done
}
trap cleanup_temp_dirs EXIT

usage() {
    cat <<'EOF'
Usage: ./install.sh [options]

Install and verify Hydro Batter Code Edit runtime dependencies. By default the
script does not use sudo or modify the host package/profile configuration. On a
Nix host it creates only a project-local Nix out-link/GC root.

Options:
  --check         Only verify the environment; do not install anything
  --dev           Install npm development dependencies too
  --system        Explicitly install missing tools with apt/dnf/pacman/apk/brew
  --no-nix        Do not build the isolated project-local Nix runtime
  --skip-jdtls    Do not install or verify Eclipse JDT LS
  -h, --help      Show this help

Environment overrides:
  JDTLS_VERSION       Eclipse JDT LS fallback version (default: 1.60.0)
  JDTLS_INSTALL_ROOT  Fallback installation root (default: project runtime)
  JDTLS_CACHE_DIR     Persistent download cache (default: project runtime/cache)
  JDTLS_DOWNLOAD_BASE Alternate mirror containing the selected version directory
  JDTLS_DOWNLOAD_URL  Complete alternate URL for the JDT LS archive
  JDTLS_CONNECTIONS   aria2 parallel connections (default: 8)
  HYDRO_BATTER_BIN    Executable link directory (default: project runtime/bin)
  CXX                 Trusted C++ compiler used for clangd and the self-check
EOF
}

while (($#)); do
    case "$1" in
        --check) CHECK_ONLY=1 ;;
        --dev) INSTALL_DEV=1 ;;
        --system) INSTALL_SYSTEM=1 ;;
        --skip-system) INSTALL_SYSTEM=0 ;;
        --no-nix) USE_NIX=0 ;;
        --skip-jdtls) SKIP_JDTLS=1 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "Unknown option: $1" ;;
    esac
    shift
done

# PM2 frequently has a smaller PATH than the login shell. The backend also
# searches this directory directly, but exporting it here keeps checks and the
# fallback installer consistent.
export PATH="$RUNTIME_BIN${PATH:+:$PATH}"

as_root() {
    if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
        "$@"
    elif have sudo; then
        sudo "$@"
    else
        die "Root privileges are required only for --system. Remove --system or install the packages manually."
    fi
}

install_system_dependencies() {
    if [[ "$OSTYPE" == darwin* ]]; then
        local llvm_prefix java_prefix
        have brew || die "Homebrew is required for --system on macOS: https://brew.sh"
        log "Installing language-server tools with Homebrew (--system was explicitly requested)"
        brew install llvm gcc openjdk@21 python@3.12 aria2 jdtls
        llvm_prefix="$(brew --prefix llvm)"
        java_prefix="$(brew --prefix openjdk@21)"
        export PATH="$llvm_prefix/bin:$java_prefix/bin:$PATH"
        return
    fi

    if have apt-get; then
        log "Installing language-server tools with apt (--system was explicitly requested)"
        as_root apt-get update
        as_root apt-get install -y ca-certificates curl gzip tar python3 g++ clangd aria2
        if apt-cache show jdtls >/dev/null 2>&1; then as_root apt-get install -y jdtls; fi
        if apt-cache show openjdk-21-jre-headless >/dev/null 2>&1; then
            as_root apt-get install -y openjdk-21-jre-headless
        elif apt-cache show openjdk-21-jdk-headless >/dev/null 2>&1; then
            as_root apt-get install -y openjdk-21-jdk-headless
        else
            warn "This apt repository has no Java 21 package; the isolated Nix runtime is recommended."
        fi
        return
    fi
    if have dnf; then
        log "Installing language-server tools with dnf (--system was explicitly requested)"
        as_root dnf install -y ca-certificates curl gzip tar python3 gcc-c++ clang-tools-extra java-21-openjdk-headless aria2
        if dnf --quiet list --available jdtls >/dev/null 2>&1; then as_root dnf install -y jdtls; fi
        return
    fi
    if have pacman; then
        log "Installing language-server tools with pacman (--system was explicitly requested)"
        as_root pacman -Sy --needed --noconfirm ca-certificates curl gzip tar python gcc clang jre21-openjdk aria2
        if pacman -Si jdtls >/dev/null 2>&1; then as_root pacman -S --needed --noconfirm jdtls; fi
        return
    fi
    if have apk; then
        log "Installing language-server tools with apk (--system was explicitly requested)"
        as_root apk add ca-certificates curl gzip tar python3 g++ clang-extra-tools openjdk21-jre aria2
        if apk search -e jdtls 2>/dev/null | grep -q '^jdtls'; then as_root apk add jdtls; fi
        return
    fi
    die "Unsupported package manager. Use the default isolated Nix path or install the tools manually."
}

java_major() {
    java -version 2>&1 | awk -F '"' '/version/ {
        split($2, parts, ".");
        if (parts[1] == "1") print parts[2]; else print parts[1];
        exit;
    }'
}

java_is_compatible() {
    local version
    have java || return 1
    version="$(java_major || true)"
    [[ "$version" =~ ^[0-9]+$ ]] && ((version >= 21))
}

find_cpp_compiler() {
    if [[ -n "${CXX:-}" && "$CXX" != *[[:space:]]* ]]; then
        if [[ -x "$CXX" ]]; then printf '%s\n' "$CXX"; return; fi
        if command -v "$CXX" >/dev/null 2>&1; then command -v "$CXX"; return; fi
    fi
    if [[ "$OSTYPE" == darwin* ]] && have brew; then
        local candidate
        candidate="$(find "$(brew --prefix)/bin" -maxdepth 1 -type l -name 'g++-*' 2>/dev/null | sort -r | head -n 1 || true)"
        if [[ -n "$candidate" ]]; then printf '%s\n' "$candidate"; return; fi
    fi
    command -v g++ 2>/dev/null || command -v c++ 2>/dev/null || command -v clang++ 2>/dev/null || true
}

register_runtime_command() {
    local name="$1" source="$2" destination="$RUNTIME_BIN/$1"
    [[ -n "$source" && -x "$source" ]] || return 0
    [[ "$source" == "$destination" ]] && return 0
    mkdir -p "$RUNTIME_BIN"
    ln -sfn -- "$source" "$destination"
}

register_detected_runtime_commands() {
    local name source compiler
    for name in clangd jdtls java python3 aria2c; do
        source="$(command -v "$name" 2>/dev/null || true)"
        register_runtime_command "$name" "$source"
    done
    compiler="$(find_cpp_compiler)"
    register_runtime_command g++ "$compiler"
}

nix_build_component() {
    local name="$1" include_clangd="$2" include_gcc="$3" include_java="$4"
    local include_jdtls="$5" include_aria2="$6" out_link="$RUNTIME_DIR/nix/$1" flake_attribute
    mkdir -p "$RUNTIME_DIR/nix"
    if have nix-build && nix-build "$ROOT_DIR/runtime.nix" \
        --arg includeClangd "$include_clangd" \
        --arg includeGcc "$include_gcc" \
        --arg includeJava "$include_java" \
        --arg includeJdtls "$include_jdtls" \
        --arg includeAria2 "$include_aria2" \
        --out-link "$out_link"; then
        export PATH="$out_link/bin:$PATH"
        return 0
    fi
    case "$name" in
        clangd) flake_attribute=clang-tools ;;
        gcc) flake_attribute=gcc ;;
        java) flake_attribute=jdk21 ;;
        jdtls) flake_attribute=jdt-language-server ;;
        aria2) flake_attribute=aria2 ;;
        *) return 1 ;;
    esac
    have nix || return 1
    warn "The configured <nixpkgs> channel failed for $name; trying the nixpkgs flake without changing any profile"
    nix --extra-experimental-features 'nix-command flakes' build \
        --out-link "$out_link" "nixpkgs#$flake_attribute" || return 1
    export PATH="$out_link/bin:$PATH"
}

install_nix_runtime() {
    local include_clangd=false include_gcc=false include_java=false include_jdtls=false
    local failures=0

    have clangd || include_clangd=true
    [[ -n "$(find_cpp_compiler)" ]] || include_gcc=true
    if ((SKIP_JDTLS == 0)); then
        have jdtls || include_jdtls=true
        java_is_compatible || include_java=true
    fi
    if [[ "$include_clangd" == false && "$include_gcc" == false && "$include_java" == false && "$include_jdtls" == false ]]; then
        log "All native language-server tools are already available; no Nix build is needed"
        return 0
    fi

    log "Building missing tools into an isolated Nix runtime (no profile or system changes)"
    if [[ "$include_clangd" == true ]] && ! nix_build_component clangd true false false false false; then
        warn "clang-tools could not be built from the configured nixpkgs"
        failures=$((failures + 1))
    fi
    if [[ "$include_gcc" == true ]] && ! nix_build_component gcc false true false false false; then
        warn "GCC could not be built from the configured nixpkgs"
        failures=$((failures + 1))
    fi
    if [[ "$include_java" == true ]] && ! nix_build_component java false false true false false; then
        warn "Java 21 could not be built from the configured nixpkgs"
        failures=$((failures + 1))
    fi
    if [[ "$include_jdtls" == true ]] && ! nix_build_component jdtls false false false true false; then
        warn "This nixpkgs channel has no usable jdt-language-server; preparing aria2 for the Eclipse fallback"
        if ! nix_build_component aria2 false false false false true; then
            warn "aria2 could not be built; the fallback will use resumable curl"
        fi
    fi
    register_detected_runtime_commands
    log "Nix runtime GC roots: $RUNTIME_DIR/nix"
    ((failures == 0))
}

install_npm_dependencies() {
    have node || die "Node.js 22+ is required but node was not found. Keep using Hydro's existing Node.js runtime."
    have npm || die "npm was not found. Keep using Hydro's existing npm rather than replacing Node.js."
    local major
    major="$(node -p 'Number(process.versions.node.split(".")[0])')"
    ((major >= 22)) || die "Node.js 22+ is required; found $(node --version). The installer will not replace Hydro's Node.js."
    log "Installing project-local npm dependencies"
    if ((INSTALL_DEV)); then
        (cd "$ROOT_DIR" && npm ci)
    else
        (cd "$ROOT_DIR" && npm ci --omit=dev)
    fi
}

sha256_file() {
    if have sha256sum; then sha256sum "$1" | awk '{print $1}';
    elif have shasum; then shasum -a 256 "$1" | awk '{print $1}';
    else die "sha256sum or shasum is required to verify JDT LS."; fi
}

download_with_resume() {
    local url="$1" output="$2" partial connections
    partial="$output.part"
    connections="${JDTLS_CONNECTIONS:-8}"
    if [[ ! "$connections" =~ ^[1-9][0-9]?$ ]] || ((connections > 16)); then
        die "JDTLS_CONNECTIONS must be an integer between 1 and 16."
    fi
    if have aria2c; then
        log "Downloading with aria2 ($connections connections); Ctrl+C is safe and the next run will resume"
        aria2c \
            --allow-overwrite=true \
            --auto-file-renaming=false \
            --console-log-level=warn \
            --continue=true \
            --dir="$(dirname "$partial")" \
            --file-allocation=none \
            --max-connection-per-server="$connections" \
            --max-tries=5 \
            --min-split-size=1M \
            --out="$(basename "$partial")" \
            --retry-wait=3 \
            --split="$connections" \
            --summary-interval=5 \
            "$url"
    else
        warn "aria2 is unavailable; using one-connection curl. On Nix, keep the default Nix runtime enabled."
        curl -fL --retry 5 --retry-all-errors --continue-at - -o "$partial" "$url"
    fi
    mv -f -- "$partial" "$output"
}

write_jdtls_launcher() {
    local target="$1" bin_dir="$2" python java bash_path launcher
    python="$(command -v python3 2>/dev/null || true)"
    java="$(command -v java 2>/dev/null || true)"
    bash_path="$(command -v bash 2>/dev/null || true)"
    [[ -x "$python" ]] || die "Python 3 is required by the Eclipse JDT LS wrapper."
    [[ -x "$java" ]] || die "Java 21+ is required by Eclipse JDT LS."
    java_is_compatible || die "Java 21+ is required by Eclipse JDT LS; found $(java -version 2>&1 | head -n 1)."
    [[ -x "$bash_path" ]] || die "bash is required to create the isolated JDT LS launcher."
    mkdir -p "$bin_dir"
    launcher="$bin_dir/jdtls"
    {
        printf '#!%s\n' "$bash_path"
        printf 'exec %q %q --java-executable %q "$@"\n' "$python" "$target/bin/jdtls" "$java"
    } > "$launcher"
    chmod 0755 "$launcher"
}

install_jdtls() {
    local install_root bin_dir target official_base download_base download_url archive_name archive checksum
    local expected actual temp_dir staged cache_dir
    if have jdtls; then
        log "Using JDT LS already available at $(command -v jdtls)"
        return
    fi
    install_root="${JDTLS_INSTALL_ROOT:-$RUNTIME_DIR}"
    bin_dir="${HYDRO_BATTER_BIN:-$RUNTIME_BIN}"
    target="$install_root/jdtls-$JDTLS_VERSION"
    official_base="https://download.eclipse.org/jdtls/milestones/$JDTLS_VERSION"
    download_base="${JDTLS_DOWNLOAD_BASE:-$official_base}"
    cache_dir="${JDTLS_CACHE_DIR:-$RUNTIME_DIR/cache}"

    if [[ -x "$target/bin/jdtls" ]]; then
        log "JDT LS $JDTLS_VERSION is already installed in the project runtime"
    else
        have curl || die "curl is required for the JDT LS fallback download."
        have tar || die "tar is required to extract JDT LS."
        archive_name="$(curl -fsSL --retry 3 "$official_base/latest.txt" | tr -d '\r\n')"
        [[ "$archive_name" =~ ^jdt-language-server-[0-9.]+-[0-9]+\.tar\.gz$ ]] \
            || die "Eclipse returned an unexpected JDT LS archive name: $archive_name"
        download_url="${JDTLS_DOWNLOAD_URL:-$download_base/$archive_name}"
        mkdir -p "$cache_dir"
        archive="$cache_dir/$archive_name"
        checksum="$cache_dir/$archive_name.sha256"
        curl -fsSL --retry 3 -o "$checksum" "$official_base/$archive_name.sha256"
        expected="$(awk '{print $1}' "$checksum")"
        [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || die "Eclipse returned an invalid JDT LS checksum."
        actual=""
        if [[ -f "$archive" ]]; then actual="$(sha256_file "$archive")"; fi
        if [[ "$actual" != "$expected" ]]; then
            log "Downloading Eclipse JDT LS $JDTLS_VERSION to project-local persistent cache: $cache_dir"
            download_with_resume "$download_url" "$archive"
            actual="$(sha256_file "$archive")"
        else
            log "Using cached Eclipse JDT LS archive"
        fi
        [[ "$actual" == "$expected" ]] || die "JDT LS checksum verification failed; remove $archive and retry."
        temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hydro-batter-jdtls.XXXXXX")"
        TEMP_DIRS+=("$temp_dir")
        staged="$temp_dir/extracted"
        mkdir -p "$staged"
        tar -xzf "$archive" -C "$staged"
        [[ -f "$staged/bin/jdtls" ]] || die "The JDT LS wrapper was not found in the archive."
        mkdir -p "$install_root"
        [[ ! -e "$target" ]] || die "$target exists but is incomplete; move it aside and re-run this script."
        cp -R "$staged" "$target"
        chmod +x "$target/bin/jdtls"
    fi

    write_jdtls_launcher "$target" "$bin_dir"
    export PATH="$bin_dir:$PATH"
}

check_environment() {
    local failures=0 compiler temp_dir java_version
    for command in node npm clangd; do
        if have "$command"; then log "$command: $(command -v "$command")";
        else warn "$command is missing"; failures=$((failures + 1)); fi
    done

    if have node; then
        local node_major
        node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
        if ((node_major < 22)); then warn "Node.js 22+ is required; found $(node --version)"; failures=$((failures + 1)); fi
    fi
    if ((SKIP_JDTLS == 0)); then
        if have jdtls; then log "jdtls: $(command -v jdtls)";
        else warn "jdtls is missing from the plugin runtime and PATH"; failures=$((failures + 1)); fi
        if have java; then
            java_version="$(java_major || true)"
            if [[ ! "$java_version" =~ ^[0-9]+$ ]] || ((java_version < 21)); then
                warn "Java 21+ is required by JDT LS; found: $(java -version 2>&1 | head -n 1)"
                failures=$((failures + 1))
            else
                log "java: $(command -v java) (major $java_version)"
            fi
        else
            warn "java is missing"; failures=$((failures + 1))
        fi
    fi
    if [[ -d "$ROOT_DIR/node_modules/pyright" ]]; then log "Bundled Pyright is installed";
    else warn "npm dependencies are incomplete (Pyright missing)"; failures=$((failures + 1)); fi

    compiler="$(find_cpp_compiler)"
    if [[ -z "$compiler" ]]; then
        warn "No C++ compiler was found"
        failures=$((failures + 1))
    else
        log "C++ compiler: $compiler"
        temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hydro-batter-cpp.XXXXXX")"
        TEMP_DIRS+=("$temp_dir")
        printf '#include <bits/stdc++.h>\nint main() { std::vector<int> v; return (int)v.size(); }\n' > "$temp_dir/main.cpp"
        if ! "$compiler" -std=c++17 -fsyntax-only "$temp_dir/main.cpp" >"$temp_dir/compiler.log" 2>&1; then
            warn "The selected compiler cannot use <bits/stdc++.h>:"
            tail -n 12 "$temp_dir/compiler.log" >&2
            failures=$((failures + 1))
        elif have clangd; then
            node - "$temp_dir" "$compiler" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const [workspace, compiler] = process.argv.slice(2);
const source = path.join(workspace, 'main.cpp');
fs.writeFileSync(path.join(workspace, 'compile_commands.json'), JSON.stringify([{
    directory: workspace,
    file: source,
    arguments: [compiler, '-std=c++17', '-fsyntax-only', source],
}]));
JS
            if ! clangd --background-index=false --query-driver="$compiler" \
                --compile-commands-dir="$temp_dir" --check="$temp_dir/main.cpp" \
                >"$temp_dir/clangd.log" 2>&1; then
                warn "clangd still cannot parse the GCC standard library:"
                tail -n 16 "$temp_dir/clangd.log" >&2
                failures=$((failures + 1))
            else
                log "clangd successfully parsed <bits/stdc++.h> with $compiler"
            fi
        fi
        rm -rf -- "$temp_dir"
    fi

    ((failures == 0)) || die "$failures dependency check(s) failed."
    log "All dependencies are ready without changing Hydro's PM2 or Nix profile configuration."
}

if ((CHECK_ONLY == 0)); then
    if ((INSTALL_SYSTEM)); then install_system_dependencies; fi
    mkdir -p "$RUNTIME_BIN"
    register_detected_runtime_commands
    if ((USE_NIX)) && { have nix-build || have nix; }; then
        install_nix_runtime || true
    fi
    register_detected_runtime_commands
    install_npm_dependencies
    if ((SKIP_JDTLS == 0)); then install_jdtls; fi
    register_detected_runtime_commands
fi

check_environment
