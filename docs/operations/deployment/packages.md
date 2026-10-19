# Native Packages

> All features are fully supported in a package install. See the [deployment compatibility matrix](../../features/deployment-matrix.md) for comparison with other modes.

`apt-get install ebpfsentinel` and `dnf install ebpfsentinel` are the shortest
path onto a Linux host, and the only one that gives unattended installs,
dependency resolution, the next version through the mechanism the host already
runs, and a removal that leaves the host as it was found.

The packages are release artifacts. They are built from the commit the release
manifest pins, for amd64 and arm64, and published in the release beside the
tarballs, covered by the same signed `ebpfsentinel-SHA256SUMS`. Nothing here is
served from anywhere else.

Requirements are the same as every other deployment: kernel 6.9 or later, BTF at
`/sys/kernel/btf/vmlinux`, systemd. The `preinst` script checks the first two and
refuses the install rather than leaving a unit that can never start.

## Adding the repository

### Debian and Ubuntu

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.gpg \
  | sudo tee /etc/apt/keyrings/ebpfsentinel.gpg > /dev/null
gpg --show-keys --with-fingerprint /etc/apt/keyrings/ebpfsentinel.gpg
echo "deb [signed-by=/etc/apt/keyrings/ebpfsentinel.gpg] https://ebpfsentinel.github.io/ebpfsentinel-release/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/ebpfsentinel.list
sudo apt-get update
sudo apt-get install ebpfsentinel
```

### Fedora, RHEL and derivatives

```bash
sudo rpm --import https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.asc
sudo curl -fsSL -o /etc/yum.repos.d/ebpfsentinel.repo \
  https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.repo
sudo dnf install ebpfsentinel
```

That file sets `gpgcheck=1` and `repo_gpgcheck=1` against the same key:

```ini
[ebpfsentinel]
name=eBPFsentinel
baseurl=https://ebpfsentinel.github.io/ebpfsentinel-release/rpm/stable/$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.asc
```

`signed-by=` and `repo_gpgcheck=1` are not decoration. Without the first, the
key is trusted for every repository the host has; without the second, dnf checks
the packages and not the index that told it which packages exist.

Check the fingerprint printed by `gpg --show-keys` against the one in the
release notes before trusting the key. A repository key always arrives from the
repository it is about to vouch for, which is why the fingerprint is published
separately and why every package can also be verified on its own, below,
without trusting this key at all.

## Installing one package, verified

A single `.deb` or `.rpm` off the release, checked against the release signing
identity rather than against a repository key. This is the air-gapped path and
the one to use when a host must not carry a third-party repository.

```bash
REL=<release>                     # for example 2026.6.1
BASE=https://github.com/ebpfsentinel/ebpfsentinel-release/releases/download/v$REL

curl -fsSLO "$BASE/ebpfsentinel_${REL}_amd64.deb"
curl -fsSLO "$BASE/ebpfsentinel-SHA256SUMS"
curl -fsSLO "$BASE/ebpfsentinel-SHA256SUMS.sig"
curl -fsSLO "$BASE/ebpfsentinel-SHA256SUMS.crt"

cosign verify-blob \
  --certificate ebpfsentinel-SHA256SUMS.crt \
  --signature ebpfsentinel-SHA256SUMS.sig \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/ebpfsentinel/ebpfsentinel-release/\.github/workflows/sign-blob\.yml@refs/tags/v.*$' \
  ebpfsentinel-SHA256SUMS

sha256sum --ignore-missing -c ebpfsentinel-SHA256SUMS
sudo apt-get install ./ebpfsentinel_${REL}_amd64.deb
```

The rpm is the same sequence with `ebpfsentinel-${REL}-1.x86_64.rpm` and
`sudo dnf install ./ebpfsentinel-${REL}-1.x86_64.rpm`. Use `arm64` and
`aarch64` for the other architecture.

Two things are being checked, and they are not the same thing: `cosign
verify-blob` says the checksum file was produced by the release workflow of this
project at a tag, and `sha256sum -c` says the package on disk is the one that
file names. Running the second without the first checks a download against a
list anybody could have written.

## What the package installs

| Path | What |
|------|------|
| `/usr/bin/ebpfsentinel-agent` | The agent |
| `/usr/bin/ebpfsentinel-warden` | The privileged broker |
| `/usr/lib/ebpfsentinel/` | The eBPF objects |
| `/etc/ebpfsentinel/config.yaml` | The configuration, mode `0640`, a conffile |
| `/usr/share/ebpfsentinel/profiles/` | The three [host profiles](../../getting-started/profiles.md) |
| `/usr/lib/systemd/system/ebpfsentinel{,-warden}.service` | Both units |
| `/usr/lib/tmpfiles.d/ebpfsentinel.conf` | The state directories, `auth/` at `0700` |
| `/etc/apparmor.d/ebpfsentinel-agent` | The profile, loaded only where the host restricts unprivileged user namespaces |
| `/usr/share/ebpfsentinel/sysctl.d/` | The user-namespace drop-in, **not** installed into `/etc/sysctl.d` |
| `/usr/share/ebpfsentinel/uninstall.sh` | The removal script, described below |

Installing starts nothing. The shipped configuration cannot guess which
interfaces to watch, so the first start is a decision:

```bash
# Start from a profile rather than from the reference configuration
sudo cp /usr/share/ebpfsentinel/profiles/home-router.yaml /etc/ebpfsentinel/config.yaml
sudo $EDITOR /etc/ebpfsentinel/config.yaml      # the interface names, and nothing else to begin with

sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel
journalctl -u ebpfsentinel -u ebpfsentinel-warden -f
```

The sysctl drop-in is host-wide, which is why it is shipped and not applied. Copy
it only on a host that gates unprivileged user namespaces behind AppArmor and
where `apparmor_parser` is absent:

```bash
sudo cp /usr/share/ebpfsentinel/sysctl.d/60-ebpfsentinel-userns.conf /etc/sysctl.d/
sudo sysctl --system
```

## Upgrading

```bash
sudo apt-get update && sudo apt-get install --only-upgrade ebpfsentinel
sudo dnf upgrade ebpfsentinel
```

The configuration is a conffile in both formats: dpkg prompts and keeps yours
by default, rpm writes the new reference beside it as `config.yaml.rpmnew`. An
upgrade never takes an operator's rules away, and never enables a unit that was
not enabled; `postinst` restarts only what was already running.

Rolling back is an install of an older version, which works because the pool
keeps every version ever published:

```bash
apt-cache madison ebpfsentinel
sudo apt-get install ebpfsentinel=<version>
sudo dnf downgrade ebpfsentinel-<version>
```

## Removing

A security agent that cannot be removed cleanly is one an operator hesitates to
install, so removal is specified rather than improvised.

```bash
sudo apt-get remove ebpfsentinel        # keeps /etc/ebpfsentinel and /var/lib/ebpfsentinel
sudo apt-get purge  ebpfsentinel        # and removes both
sudo dnf remove ebpfsentinel            # keeps both; rpm has no purge
```

Either way the units are stopped and disabled first, and the bpffs pins under
`/sys/fs/bpf/ebpfsentinel*` are unmounted and removed, so the programs are
detached from every interface and nothing of the datapath outlives the package.
What survives a plain removal is the configuration and the state directory, on
purpose: the state holds the alerts, the flows, the captures and the API key.

`rpm` has no purge, and a tarball install has no package manager, so both reach
the same end through the script the package also ships:

```bash
sudo /usr/share/ebpfsentinel/uninstall.sh            # stop, detach, unpin, report what is left
sudo /usr/share/ebpfsentinel/uninstall.sh --purge    # and remove the configuration and the state
```

It detects a packaged install and refuses to delete files the package manager
owns, printing the `apt-get` or `dnf` command instead. On a tarball install it
removes what `install.sh` wrote under `/usr/local`. In both cases it ends by
listing what it left behind and why, including the journal, which no uninstall
touches.

## NixOS

NixOS installs nothing through a package manager's imperative path, so it gets a
module instead of a package. Both files are in the source tree under
`dist/nix/`.

`package.nix` builds a derivation from the published release tarball. It takes
the version and the hashes as arguments and has no defaults for either, because
a module cannot invent which release a host runs, and it deliberately does not
build from source: the eBPF objects are built by a pinned nightly toolchain for
a target nixpkgs does not carry, and a local rebuild would produce objects
nobody signed.

```nix
# flake.nix, or any module list
{
  imports = [ "${ebpfsentinelSrc}/dist/nix/module.nix" ];

  services.ebpfsentinel = {
    enable = true;

    package = pkgs.callPackage "${ebpfsentinelSrc}/dist/nix/package.nix" {
      version = "2026.6.1";
      # From the release's ebpfsentinel-SHA256SUMS, as an SRI hash:
      #   nix hash convert --hash-algo sha256 --to sri <the sum of the linux-amd64 tarball>
      hashes.x86_64-linux = "sha256-0000000000000000000000000000000000000000000=";
    };

    settings = {
      agent = {
        interfaces = [ "enp1s0" ];
        bind_address = "127.0.0.1";
      };
      firewall = {
        enabled = true;
        default_policy = "allow";
      };
      ids = {
        enabled = true;
        mode = "alert";
      };
    };
  };
}
```

`settings` is freeform and rendered to YAML, so every key in the
[configuration reference](../../configuration/overview.md) is accepted under its
own name; the module invents none and renames none. Three other ways to say the
same thing exist and only one may be used at a time: `profile` names one of the
shipped host profiles, `configFile` points at a file managed elsewhere, and
leaving all three unset runs the reference configuration.

What the module does beyond writing that file:

- defines both units the way the packages define them, including the watchdog,
  the warden socket wait, `LimitMEMLOCK=infinity` and the stop budget;
- points `EBPF_PROGRAM_DIR` at the objects inside the store path, since neither
  `/usr/local/lib/ebpfsentinel` nor `/usr/lib/ebpfsentinel` exists on NixOS;
- creates `/var/lib/ebpfsentinel` and its `data`, `captures` and `auth`
  subdirectories through `systemd.tmpfiles.rules`, `auth` at `0700`;
- asserts the 6.9 kernel floor at evaluation time, so a host on an older kernel
  fails to build rather than failing to load its programs at three in the
  morning.

Removal is `services.ebpfsentinel.enable = false` and a rebuild: the units go,
the store path is collected, and `/var/lib/ebpfsentinel` stays until it is
deleted by hand, like every other piece of state on a NixOS host.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `NO_PUBKEY` or `repomd.xml.asc` rejected | The key was not imported, or was imported into the wrong keyring. Re-run the key step; on apt the key must be the one `signed-by=` names |
| `kernel 6.x is below the 6.9 floor` from `preinst` | The host cannot run the agent at all. [Check compatibility](../compatibility.md) before forcing anything |
| Both units installed, nothing running | By design. Nothing is enabled or started by the package |
| `BPF token unavailable - running in API-only mode` | The agent started before the warden. Enable both units; the agent unit waits for the socket but will not create it |
| An upgrade did not change the configuration | Also by design. dpkg kept yours, rpm wrote `config.yaml.rpmnew` beside it |

See [Binary Deployment](binary.md) for the tarball layout and the runtime
detail both installs share, and the
[BPF token guide](bpf-token.md) for the startup sequence.
