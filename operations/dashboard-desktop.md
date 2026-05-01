# Desktop Console

The eBPFsentinel dashboard ships as a native desktop application built
with [Tauri 2](https://v2.tauri.app/). It reuses the same Leptos
frontend crate and bundles the `dashboard-server` binary as a sidecar
process.

## Installation

### Linux (deb / AppImage)

```bash
# Debian / Ubuntu
sudo dpkg -i ebpfsentinel-dashboard_0.x.x_amd64.deb

# AppImage (no install required)
chmod +x eBPFsentinel-Dashboard_0.x.x_amd64.AppImage
./eBPFsentinel-Dashboard_0.x.x_amd64.AppImage
```

### macOS

```bash
# Open the .dmg and drag to /Applications
open eBPFsentinel-Dashboard_0.x.x_universal.dmg
```

### Windows

Run the `.msi` installer or extract the portable `.exe`.

## Configuration

The desktop app looks for `dashboard.yaml` in this order:

1. `DASHBOARD_CONFIG` environment variable
2. `<app-config-dir>/dashboard.yaml`
   - Linux: `~/.config/com.ebpfsentinel.dashboard/dashboard.yaml`
   - macOS: `~/Library/Application Support/com.ebpfsentinel.dashboard/dashboard.yaml`
   - Windows: `%APPDATA%\com.ebpfsentinel.dashboard\dashboard.yaml`
3. `~/.config/ebpfsentinel/dashboard.yaml` (fallback)

The configuration format is identical to the server deployment — see
[dashboard configuration](../configuration/dashboard.md).

## Architecture

```text
┌─────────────────────────────────────────┐
│  Tauri native window                    │
│  ┌───────────────────────────────────┐  │
│  │  WebView (Leptos WASM frontend)   │  │
│  │  API calls → Tauri IPC invoke()   │  │
│  │  SSE → direct localhost:PORT      │  │
│  └───────────────┬───────────────────┘  │
│                  │ IPC                  │
│  ┌───────────────▼───────────────────┐  │
│  │  Tauri backend (Rust)             │  │
│  │  • proxy commands → HTTP          │  │
│  │  • keyring (OS credential store)  │  │
│  │  • deep-link handler              │  │
│  │  • auto-updater                   │  │
│  └───────────────┬───────────────────┘  │
│                  │ HTTP (localhost)      │
│  ┌───────────────▼───────────────────┐  │
│  │  dashboard-server (child process) │  │
│  │  • OIDC + agent pool + proxy      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

The dashboard-server runs on a random localhost port. The Tauri backend
discovers the port at startup and proxies all API calls through IPC
commands. SSE streams connect directly from the WebView to the local
server.

## OIDC Authentication

The desktop app registers the `ebpfsentinel://` custom URL scheme with
the operating system. During OIDC sign-in:

1. The app opens the OIDC provider's authorize URL in the default
   browser.
2. After authentication, the provider redirects to
   `ebpfsentinel://auth/callback?code=...&state=...`.
3. The OS routes the deep link to the Tauri app.
4. The Tauri backend exchanges the code for tokens and stores the
   session JWT in the OS keyring.

## Secret Storage

Session tokens are stored in the OS credential manager:

| OS      | Backend                      |
|---------|------------------------------|
| Linux   | Secret Service (D-Bus)       |
| macOS   | Keychain                     |
| Windows | Windows Credential Manager   |

The service name is `ebpfsentinel-dashboard`.

## Auto-Update

The app ships with [Tauri updater](https://v2.tauri.app/plugin/updater/)
support. Configure the update endpoint in `tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<your-ed25519-public-key>",
      "endpoints": [
        "https://releases.example.com/ebpfsentinel/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

Generate signing keys with `tauri signer generate -w ~/.tauri/keys`.

## Code Signing

Code signing is **not configured by default**. Customers sign binaries
with their own certificate.

### macOS

```bash
export APPLE_CERTIFICATE="base64-encoded-p12"
export APPLE_CERTIFICATE_PASSWORD="..."
export APPLE_SIGNING_IDENTITY="Developer ID Application: ..."
cargo tauri build --target universal-apple-darwin
```

Notarization is optional — pass `--apple-notarize` if configured.

### Windows

Sign the MSI with `signtool` after the build:

```powershell
signtool sign /sha1 <thumbprint> /t http://timestamp.digicert.com `
  target\release\bundle\msi\*.msi
```

## Building from Source

### Prerequisites

- Rust stable ≥ 1.95 with `wasm32-unknown-unknown` target
- Tauri CLI: `cargo install tauri-cli --version "^2"`
- System dependencies:
  - **Linux**: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev`
  - **macOS**: Xcode command line tools
  - **Windows**: Visual Studio C++ build tools, WebView2

### Build Steps

```bash
# 1. Build the WASM frontend with the tauri feature
cd crates/dashboard-app
cargo build --target wasm32-unknown-unknown --features tauri --release
wasm-bindgen --target web --out-dir target/site/pkg \
  ../../target/wasm32-unknown-unknown/release/dashboard_app.wasm

# 2. Build the dashboard-server sidecar
cargo build --release -p dashboard-server
cp target/release/dashboard-server \
  crates/dashboard-tauri/binaries/dashboard-server-$(rustc -vV | grep host | cut -d' ' -f2)

# 3. Build the Tauri desktop app
cd crates/dashboard-tauri
cargo tauri build --release
```

Output binaries land in `crates/dashboard-tauri/target/release/bundle/`.

## Binary Size

Target: ≤ 30 MB on Linux x86\_64 (achieved via Tauri's lightweight
WebView approach vs Electron's bundled Chromium).

The release profile uses `lto = "fat"`, `codegen-units = 1`, and
`strip = true` to minimise binary size.
