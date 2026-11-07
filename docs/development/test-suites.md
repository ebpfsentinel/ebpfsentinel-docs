# Test Suites and Proof

Every claim the documentation makes about the agent's behaviour is meant to be
checkable by running something. This page says where those runs live and how
to start one.

## What exists

| Where | What it proves |
|-------|----------------|
| `tests/integration/suites/` | End-to-end `bats` suites against a running agent: the REST and gRPC surfaces, each eBPF program on real traffic, the Docker and Kubernetes deployments |
| `tests/integration/coverage-matrix.yaml` | Maps every eBPF program, CLI subcommand, domain module and REST route to the suites that exercise it; CI fails on a surface missing from it |
| `tests/integration/skip-policy.yaml` | Classifies every skip reason as `env` (the capability is absent) or `masking` (a prerequisite is missing); `EBPFSENTINEL_STRICT_SKIPS=1` turns a masking skip into a failure |
| `tests/perf/` | Throughput, per-feature overhead, map operations, high packet rates, attribution cost; results in `tests/perf/BENCHMARK-RESULTS.md` |
| `fuzz/` | `cargo fuzz` targets for the parsers and the rule engines |

The suites are numbered files; list them rather than trust a count:

```bash
ls tests/integration/suites/
```

## Running one

From `tests/integration/` in the agent repository:

```bash
make test-suite SUITE=01-agent-lifecycle   # one suite, against a locally built agent
make test                                  # every suite
make test-ebpf-scenarios                   # the eBPF datapath suites, via sudo
make test-vm                               # every suite inside the test VM
```

Some suites need a second or third machine (an attacker, a backend) and run
through the `vagrant-2vm-*` and `vagrant-3vm-*` targets; `make help` lists them.
The performance suites run from `tests/perf/` with `make all` or
`make suite SUITE=02-ebpf-feature-overhead`, as root.

## What CI runs

- On every pull request and push to `main`, the fast suites of the `pr`
  profile, then the eBPF program suite, the suite asserting that every program
  loads and the Docker published-port suite, under `EBPFSENTINEL_STRICT_SKIPS=1`.
- On every change, the coverage audit against `coverage-matrix.yaml`.
- Weekly, the benchmarks and mutation testing of the domain crate.
- The `nightly` and `full` profiles, which need the multi-machine lab, are
  started by hand.

Unit tests and the build itself are described in [Testing](testing.md).
