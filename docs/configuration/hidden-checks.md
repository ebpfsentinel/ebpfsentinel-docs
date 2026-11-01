# Hidden Checks Configuration

The hidden checks compare two readings of the same kernel state and report an
entry the kernel holds and its own listings leave out. What each reads, what
explains a difference first and what it cannot see is on
[Hidden Ports](../features/hidden-ports.md).

Nothing here enforces anything: the checks only read, and the port sweep binds
each probed port for an instant and closes it.

## Configuration

```yaml
hidden_checks:
  ports:
    enabled: true
    interval_secs: 300
    well_known: true
    extra_ports: [31337]
```

## Reference

### `ports`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Run the port sweep at all |
| `interval_secs` | u64 | `300` | How often every network namespace is swept, in seconds |
| `well_known` | bool | `true` | Probe ports 1 to 1024 |
| `extra_ports` | list of u16 | `[]` | Ports probed in addition |

`interval_secs` is accepted between `60` and `86400`. Port `0` is refused in
`extra_ports`, which holds at most 4096 entries, and a sweep turned on with
`well_known: false` and no `extra_ports` fails at boot rather than probing
nothing.

Each sweep probes every port, TCP and UDP, on both wildcard addresses, in every
namespace, and probes again whatever was refused, so its cost grows with the
number of namespaces times the number of ports. Turning the sweep off stops the
readings and the alerts, and the API route answers `reading: false`.
