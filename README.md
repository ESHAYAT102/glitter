# Glitter

A local browser terminal backed by your default shell.

```sh
go build -o glitter .
./glitter
```

Open `http://<tailscale-ip>:3388` from another device. Use `tailscale ip -4` to find the address, or `./glitter -addr 127.0.0.1:3388` to keep Glitter device-only.

Install Glitter to `${XDG_BIN_HOME:-$HOME/.local/bin}` or remove it again with:

```sh
./scripts/install.sh
./scripts/uninstall.sh
```

The binary embeds the UI and its xterm.js assets. Icons are from [Hugeicons](https://hugeicons.com/) under the MIT license.

On Omarchy, Glitter automatically uses the active `colors.toml` palette for terminal colors while keeping its Mauve terminal background. Open **Sessions → Settings** to apply a custom compatible palette, reload the current Omarchy theme, or choose the terminal font.
