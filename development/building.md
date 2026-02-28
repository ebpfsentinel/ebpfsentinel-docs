# Building

## Prerequisites

See [Prerequisites](../getting-started/prerequisites.md) for the full list.

Quick setup:

```bash
# Stable (userspace)
rustup toolchain install stable
rustup component add rustfmt clippy rust-src

# Nightly (eBPF programs)
rustup toolchain install nightly --component rust-src
```

## Userspace Agent

```bash
cargo build                    # Debug build
cargo build --release          # Release build
```

## eBPF Kernel Programs

```bash
cargo xtask ebpf-build         # Builds all 6 programs with nightly
```

The eBPF programs are built for `bpfel-unknown-none` (little-endian BPF) and output to each program's `target/` directory. The `xtask` crate orchestrates this.

## Full Build

```bash
cargo xtask ebpf-build && cargo build --release
```

## Docker

### Build Image

```bash
docker build -t ebpfsentinel .
```

The `Dockerfile` uses a multi-stage build:
1. Stage 1: Build eBPF programs (nightly toolchain)
2. Stage 2: Build userspace agent (stable toolchain)
3. Stage 3: Minimal runtime image

## Verification

```bash
# Check the binary
./target/release/ebpfsentinel-agent version

# Run clippy
cargo clippy -- -D warnings

# Run format check
cargo fmt --check

# Dependency audit
cargo deny check
```
