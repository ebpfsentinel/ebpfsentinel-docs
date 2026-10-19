# Installation

Everything below installs the same two processes: the agent and the privileged
warden broker beside it. Pick the path that matches the host, in the order they
are given: the package is what a Linux host is built to install, the tarball is
for a host with no repository, and the source build is for contributors.

Every artifact comes from one place, the
[release repository](https://github.com/ebpfsentinel/ebpfsentinel-release/releases),
and each is signed and listed in that release's `ebpfsentinel-SHA256SUMS`. No
step here asks you to clone a repository in order to run something.

Before anything: kernel 6.9 or later with BTF at `/sys/kernel/btf/vmlinux`. See
[Prerequisites](prerequisites.md), and [Compatibility](../operations/compatibility.md)
for the distributions that qualify today.

## Packages (recommended)

Debian and Ubuntu:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.gpg \
  | sudo tee /etc/apt/keyrings/ebpfsentinel.gpg > /dev/null
gpg --show-keys --with-fingerprint /etc/apt/keyrings/ebpfsentinel.gpg
echo "deb [signed-by=/etc/apt/keyrings/ebpfsentinel.gpg] https://ebpfsentinel.github.io/ebpfsentinel-release/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/ebpfsentinel.list
sudo apt-get update && sudo apt-get install ebpfsentinel
```

Fedora, RHEL and derivatives:

```bash
sudo rpm --import https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.asc
sudo curl -fsSL -o /etc/yum.repos.d/ebpfsentinel.repo \
  https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.repo
sudo dnf install ebpfsentinel
```

Check the fingerprint `gpg --show-keys` prints against the one in the release
notes. Installing starts nothing: the shipped configuration cannot guess which
interfaces to watch.

```bash
sudo cp /usr/share/ebpfsentinel/profiles/home-router.yaml /etc/ebpfsentinel/config.yaml
sudo $EDITOR /etc/ebpfsentinel/config.yaml     # the interface names
sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel
```

A single package off the release, verified against the release signing identity
rather than a repository key, is the air-gapped path and is in
[Native Packages](../operations/deployment/packages.md), along with what the
package installs where, how an upgrade treats the configuration, and how a
removal leaves the host. The three
[host profiles](profiles.md) are a home router, a k3s node and a Proxmox host.

## Release tarball

For a host that carries no third-party repository, or an architecture-pinned
install under configuration management.

```bash
REL=<release>
BASE=https://github.com/ebpfsentinel/ebpfsentinel-release/releases/download/v$REL

curl -fsSLO "$BASE/ebpfsentinel-${REL}-linux-amd64.tar.gz"
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
tar xzf "ebpfsentinel-${REL}-linux-amd64.tar.gz"
cd "ebpfsentinel-${REL}-linux-amd64"
sudo ./install.sh
```

`cosign verify-blob` says the checksum file came from this project's release
workflow at a tag; `sha256sum -c` says the file on disk is the one it names.
The second without the first checks a download against a list anybody could
have written.

`install.sh` writes under `/usr/local`, installs both units and enables
nothing. Its full layout is in
[Binary Deployment](../operations/deployment/binary.md), and
`sudo /usr/local/share/ebpfsentinel/uninstall.sh` reverses it.

## NixOS

`dist/nix/module.nix` in the source tree exposes the configuration as typed
options and defines both units the way the packages do. The module takes a
package built from the published tarball by `dist/nix/package.nix`, which is
given the release version and its hashes. The worked example is in
[Native Packages](../operations/deployment/packages.md#nixos).

## Docker

A deployment is two containers built from two images: the privileged **warden**
broker and the rootless **agent**. The agent drops every capability, unshares its
own user namespace, has the warden delegate a bpffs over a shared socket and
loads its eBPF through a BPF token (kernel 6.9+).

```bash
docker compose up -d       # docker-compose.yml wires both services and the shared socket volume
docker compose logs -f
docker compose down
```

Both images are published by the release and cosign-signed. See
[Docker deployment](../operations/deployment/docker.md) for the host
prerequisites (config ownership, AppArmor user namespaces), the image names and
a two-container `docker run` equivalent.

## Kubernetes

Install the Helm chart, which deploys a DaemonSet (one pod per node) carrying the
warden as a native sidecar beside the agent:

```bash
helm install ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  --version <version> -n ebpfsentinel --create-namespace
```

The chart needs Kubernetes 1.29 or later. See
[Kubernetes Deployment](../operations/deployment/kubernetes.md) for the values and
the [BPF token guide](../operations/deployment/bpf-token.md) for the startup
sequence.

## Build from source

For contributors and for reading the code, not for running the agent on a host
you care about: a local build produces eBPF objects nobody signed, and it is not
what any published path installs.

```bash
git clone https://github.com/ebpfsentinel/ebpfsentinel.git
cd ebpfsentinel

cargo xtask ebpf-build     # the eBPF programs, on the pinned nightly
cargo build --release --bin ebpfsentinel-agent --bin warden
./target/release/ebpfsentinel-agent version
```

The binaries are `target/release/ebpfsentinel-agent` and `target/release/warden`;
the eBPF objects land in `target/bpfel-unknown-none/release/`, which is where the
agent looks last. Installing a source build by hand is in
[Binary Deployment](../operations/deployment/binary.md#from-a-source-build).

## After installing

```bash
sudo systemctl status ebpfsentinel ebpfsentinel-warden
curl http://localhost:8080/healthz
# {"status":"ok"}

# Everything under /api/v1 authenticates. With no auth method configured the
# agent drew a key for itself at first start, printed it once and kept it here:
export EBPFSENTINEL_TOKEN=$(sudo cat /var/lib/ebpfsentinel/auth/api-key)
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ebpf/status
```

The agent binds to `127.0.0.1` out of the box. Moving it to an address other
hosts can reach takes a certificate and key under `agent.tls`, or the explicit
`agent.allow_plaintext_api: true`; the agent refuses to start in the clear on a
reachable address. See [TLS](../configuration/tls.md) and
[Authentication](../configuration/auth.md).

Next: [Quickstart](quickstart.md) - configure your first security rules.
