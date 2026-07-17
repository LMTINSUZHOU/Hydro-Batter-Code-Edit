#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
JDTLS_VERSION="${JDTLS_VERSION:-1.60.0}"
CHECK_ONLY=0
INSTALL_DEV=0
SKIP_SYSTEM=0
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

Install and verify Hydro Batter Code Edit runtime dependencies.

Options:
  --check         Only verify the environment; do not install anything
  --dev           Install npm development dependencies too
  --skip-system   Do not invoke the operating-system package manager
  --skip-jdtls    Do not download Eclipse JDT LS
  -h, --help      Show this help

Environment overrides:
  JDTLS_VERSION       Eclipse JDT LS milestone version (default: 1.60.0)
  JDTLS_INSTALL_ROOT  Installation root (default: /opt/hydro-batter-code-edit)
  HYDRO_BATTER_BIN    Executable link directory (default: /usr/local/bin)
  CXX                 Trusted C++ compiler used for the self-check
EOF
}

while (($#)); do
    case "$1" in
        --check) CHECK_ONLY=1 ;;
        --dev) INSTALL_DEV=1 ;;
        --skip-system) SKIP_SYSTEM=1 ;;
        --skip-jdtls) SKIP_JDTLS=1 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "Unknown option: $1" ;;
    esac
    shift
done

as_root() {
    if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
        "$@"
    elif have sudo; then
        sudo "$@"
    else
        die "Root privileges are required for system packages. Re-run as root or install them manually."
    fi
}

install_system_dependencies() {
    if [[ "$OSTYPE" == darwin* ]]; then
        local command_bin java_home java_prefix llvm_home
        have brew || die "Homebrew is required on macOS: https://brew.sh"
        log "Installing clangd, GNU C++, Java 21 and Python with Homebrew"
        brew install llvm gcc openjdk@21 python@3.12
        command_bin="${HYDRO_BATTER_BIN:-/usr/local/bin}"
        java_prefix="$(brew --prefix openjdk@21)"
        java_home="$java_prefix/libexec/openjdk.jdk"
        llvm_home="$(brew --prefix llvm)"
        as_root mkdir -p "$command_bin" /Library/Java/JavaVirtualMachines
        if [[ ! -e "$command_bin/clangd" || -L "$command_bin/clangd" ]]; then
            as_root ln -sfn "$llvm_home/bin/clangd" "$command_bin/clangd"
        fi
        if [[ ! -e /Library/Java/JavaVirtualMachines/openjdk-21.jdk || -L /Library/Java/JavaVirtualMachines/openjdk-21.jdk ]]; then
            as_root ln -sfn "$java_home" /Library/Java/JavaVirtualMachines/openjdk-21.jdk
        fi
        export PATH="$llvm_home/bin:$java_prefix/bin:$PATH"
        return
    fi

    if have apt-get; then
        log "Installing clangd, GNU C++, Java 21 and helper tools with apt"
        as_root apt-get update
        as_root apt-get install -y ca-certificates curl gzip tar python3 g++ clangd
        if apt-cache show openjdk-21-jre-headless >/dev/null 2>&1; then
            as_root apt-get install -y openjdk-21-jre-headless
        elif apt-cache show openjdk-21-jdk-headless >/dev/null 2>&1; then
            as_root apt-get install -y openjdk-21-jdk-headless
        else
            warn "This apt repository has no Java 21 package. Install a Java 21+ runtime before continuing."
        fi
        return
    fi
    if have dnf; then
        log "Installing clangd, GNU C++, Java 21 and helper tools with dnf"
        as_root dnf install -y ca-certificates curl gzip tar python3 gcc-c++ clang-tools-extra java-21-openjdk-headless
        return
    fi
    if have pacman; then
        log "Installing clangd, GNU C++, Java 21 and helper tools with pacman"
        as_root pacman -Sy --needed --noconfirm ca-certificates curl gzip tar python gcc clang jre21-openjdk
        return
    fi
    if have apk; then
        log "Installing clangd, GNU C++, Java 21 and helper tools with apk"
        as_root apk add ca-certificates curl gzip tar python3 g++ clang-extra-tools openjdk21-jre
        return
    fi
    die "Unsupported package manager. Install clangd, GNU g++, Java 21+, Python 3, curl and tar manually."
}

install_npm_dependencies() {
    have node || die "Node.js 22+ is required but node was not found."
    have npm || die "npm was not found."
    local major
    major="$(node -p 'Number(process.versions.node.split(".")[0])')"
    ((major >= 22)) || die "Node.js 22+ is required; found $(node --version)."
    log "Installing npm dependencies"
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

install_jdtls() {
    local install_root bin_dir target base archive_name archive checksum expected actual temp_dir staged
    install_root="${JDTLS_INSTALL_ROOT:-/opt/hydro-batter-code-edit}"
    bin_dir="${HYDRO_BATTER_BIN:-/usr/local/bin}"
    if [[ ${EUID:-$(id -u)} -ne 0 ]] && ! have sudo; then
        install_root="${JDTLS_INSTALL_ROOT:-${HOME:?}/.local/share/hydro-batter-code-edit}"
        bin_dir="${HYDRO_BATTER_BIN:-${HOME:?}/.local/bin}"
    fi
    target="$install_root/jdtls-$JDTLS_VERSION"
    base="https://download.eclipse.org/jdtls/milestones/$JDTLS_VERSION"

    if [[ -x "$target/bin/jdtls" ]]; then
        log "JDT LS $JDTLS_VERSION is already installed"
    else
        have curl || die "curl is required to download JDT LS."
        have tar || die "tar is required to extract JDT LS."
        archive_name="$(curl -fsSL --retry 3 "$base/latest.txt" | tr -d '\r\n')"
        [[ "$archive_name" =~ ^jdt-language-server-[0-9.]+-[0-9]+\.tar\.gz$ ]] \
            || die "Eclipse returned an unexpected JDT LS archive name: $archive_name"
        temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hydro-batter-jdtls.XXXXXX")"
        TEMP_DIRS+=("$temp_dir")
        archive="$temp_dir/$archive_name"
        checksum="$archive.sha256"
        log "Downloading Eclipse JDT LS $JDTLS_VERSION"
        curl -fL --retry 3 -o "$archive" "$base/$archive_name"
        curl -fsSL --retry 3 -o "$checksum" "$base/$archive_name.sha256"
        expected="$(awk '{print $1}' "$checksum")"
        actual="$(sha256_file "$archive")"
        [[ "$expected" =~ ^[[:xdigit:]]{64}$ && "$actual" == "$expected" ]] \
            || die "JDT LS checksum verification failed."
        staged="$temp_dir/extracted"
        mkdir -p "$staged"
        tar -xzf "$archive" -C "$staged"
        [[ -f "$staged/bin/jdtls" ]] || die "The JDT LS wrapper was not found in the archive."
        as_root mkdir -p "$install_root" "$bin_dir"
        [[ ! -e "$target" ]] || die "$target exists but is incomplete; move it aside and re-run this script."
        as_root cp -R "$staged" "$target"
        as_root chmod +x "$target/bin/jdtls"
    fi

    if [[ -e "$bin_dir/jdtls" && ! -L "$bin_dir/jdtls" ]]; then
        warn "$bin_dir/jdtls already exists and was not replaced. Set the plugin's JDT LS path manually if needed."
    else
        as_root mkdir -p "$bin_dir"
        as_root ln -sfn "$target/bin/jdtls" "$bin_dir/jdtls"
    fi
    export PATH="$bin_dir:$PATH"
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

java_major() {
    java -version 2>&1 | awk -F '"' '/version/ {
        split($2, parts, ".");
        if (parts[1] == "1") print parts[2]; else print parts[1];
        exit;
    }'
}

check_environment() {
    local failures=0 compiler temp_dir java_version
    for command in node npm python3 clangd java; do
        if have "$command"; then log "$command: $(command -v "$command")";
        else warn "$command is missing"; failures=$((failures + 1)); fi
    done

    if have node; then
        local node_major
        node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
        if ((node_major < 22)); then warn "Node.js 22+ is required; found $(node --version)"; failures=$((failures + 1)); fi
    fi
    if have java; then
        java_version="$(java_major)"
        if [[ ! "$java_version" =~ ^[0-9]+$ ]] || ((java_version < 21)); then
            warn "Java 21+ is required by JDT LS; found: $(java -version 2>&1 | head -n 1)"
            failures=$((failures + 1))
        fi
    fi
    if ((SKIP_JDTLS == 0)); then
        if have jdtls; then log "jdtls: $(command -v jdtls)";
        else warn "jdtls is missing from PATH"; failures=$((failures + 1)); fi
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
        elif have clangd && have python3; then
            python3 - "$temp_dir" "$compiler" <<'PY'
import json, os, sys
workspace, compiler = sys.argv[1:]
source = os.path.join(workspace, "main.cpp")
with open(os.path.join(workspace, "compile_commands.json"), "w", encoding="utf-8") as stream:
    json.dump([{"directory": workspace, "file": source,
                "arguments": [compiler, "-std=c++17", "-fsyntax-only", source]}], stream)
PY
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
    log "All Hydro Batter Code Edit dependencies are ready."
}

if ((CHECK_ONLY == 0)); then
    ((SKIP_SYSTEM)) || install_system_dependencies
    install_npm_dependencies
    ((SKIP_JDTLS)) || install_jdtls
fi

check_environment
