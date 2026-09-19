#!/usr/bin/env sh
set -eu

binary_name="glitter"
install_dir="${XDG_BIN_HOME:-${HOME}/.local/bin}"
path="$install_dir/$binary_name"

if [ -e "$path" ]; then
	rm -f "$path"
	echo "removed $binary_name from $path"
else
	echo "$binary_name was not found at $path"
fi
