#!/usr/bin/env sh
set -eu

repo_url="${GLITTER_REPO_URL:-https://github.com/ESHAYAT102/glitter.git}"
binary_name="glitter"
install_dir="${XDG_BIN_HOME:-${HOME}/.local/bin}"
project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
clone_dir=""

has() {
	command -v "$1" >/dev/null 2>&1
}

prompt_yes_no() {
	if [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
		echo "error: cannot prompt for confirmation without a terminal" >&2
		exit 1
	fi
	while true; do
		printf "%s [Y/n] " "$1" >/dev/tty
		IFS= read -r answer </dev/tty || answer=""
		case "$answer" in
			"" | [Yy] | [Yy][Ee][Ss]) return 0 ;;
			[Nn] | [Nn][Oo]) return 1 ;;
			*) echo "please answer Y or n" >/dev/tty ;;
		esac
	done
}

cleanup() {
	if [ -n "${clone_dir:-}" ] && [ -d "$clone_dir" ]; then
		rm -rf "$clone_dir"
	fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

run_as_root() {
	if [ "$(id -u)" -eq 0 ]; then
		"$@"
	elif has sudo; then
		sudo "$@"
	else
		echo "error: sudo is required to install missing packages" >&2
		exit 1
	fi
}

install_dependencies() {
	case "$(uname -s)" in
		Darwin)
			has brew || { echo "error: Homebrew is required to install Go and git" >&2; exit 1; }
			brew install go git
			;;
		Linux)
			if has pacman; then run_as_root pacman -Sy --needed --noconfirm go git
			elif has apt-get; then run_as_root apt-get update; run_as_root apt-get install -y golang-go git
			elif has dnf; then run_as_root dnf install -y golang git
			elif has yum; then run_as_root yum install -y golang git
			elif has zypper; then run_as_root zypper --non-interactive install go git
			elif has apk; then run_as_root apk add go git
			elif has xbps-install; then run_as_root xbps-install -Sy go git
			else echo "error: no supported package manager found" >&2; exit 1
			fi
			;;
		*) echo "error: unsupported OS: $(uname -s)" >&2; exit 1 ;;
	esac
	hash -r 2>/dev/null || true
}

if ! has go || ! has git; then
	missing=""
	has go || missing="Go"
	if ! has git; then missing="${missing:+$missing and }git"; fi
	prompt_yes_no "Install missing required software ($missing) now?" || {
		echo "error: $missing is required to install $binary_name" >&2
		exit 1
	}
	install_dependencies
fi

has go && has git || { echo "error: Go and git are required" >&2; exit 1; }
mkdir -p "$install_dir"

if [ ! -f "$project_dir/go.mod" ]; then
	clone_dir="$(mktemp -d "${TMPDIR:-/tmp}/glitter.XXXXXX")"
	echo "cloning $repo_url"
	git clone --depth 1 "$repo_url" "$clone_dir"
	project_dir="$clone_dir"
fi

echo "building $binary_name"
(cd "$project_dir" && go build -o "$install_dir/$binary_name" .)
chmod +x "$install_dir/$binary_name"
echo "installed $binary_name to $install_dir/$binary_name"

case ":$PATH:" in
	*":$install_dir:"*) ;;
	*)
		echo "warning: $install_dir is not in PATH"
		echo "add this to your shell profile:"
		echo "  export PATH=\"$install_dir:\$PATH\""
		;;
esac
