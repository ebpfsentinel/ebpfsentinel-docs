# Package Inventory Configuration

What the dpkg, rpm and Alpine databases say is installed, in the host's root
and every container's, and the modules every running Go program was built
from. What is read, and what is not, is on
[Installed Packages](../features/installed-packages.md).

## Configuration

```yaml
package_inventory:
  enabled: true
  interval_secs: 900
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Read the package databases at all |
| `interval_secs` | u64 | `900` | How often every root is read, in seconds |

`interval_secs` is accepted between `60` and `86400`, and an unknown key in the
block fails at boot. A database that has not changed since the last reading is
looked at and not read again, so a short interval costs little on a node where
nothing is installed. The build information of running Go programs is read
again on every reading, at most 12 MiB of it. Turning the inventory off stops the readings and the API
route answers `reading: false`.
