# Auto-Capture Configuration

The `auto_capture` section configures automatic PCAP packet capture when high-severity alerts fire. One capture runs at a time. This is the OSS auto-capture feature -- Enterprise adds ring buffer captures, multi-capture, flow timeline, and a forensics API.

## Reference

```yaml
auto_capture:
  enabled: true
  min_severity: high
  components: []
  duration_secs: 30
  snap_length: 1500
  interface: eth0
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable auto-capture |
| `min_severity` | string | `"high"` | Minimum alert severity to trigger capture: `low`, `medium`, `high`, `critical` |
| `components` | list | `[]` | Component filter (e.g., `[ids, ddos]`). Empty matches all components |
| `duration_secs` | u64 | `30` | Capture duration in seconds (max 60 in OSS) |
| `snap_length` | u32 | `1500` | Snap length in bytes (maximum bytes captured per packet) |
| `interface` | string | `null` | Interface to capture on. If omitted, uses the first agent interface |

## OSS Limits

The OSS edition limits capture duration to a maximum of 60 seconds and allows only one capture at a time. Enterprise removes the duration cap and adds ring buffer captures, concurrent multi-capture, flow timeline visualization, and a forensics API.

## Example

```yaml
auto_capture:
  enabled: true
  min_severity: high
  components: [ids, ddos]
  duration_secs: 30
  snap_length: 1500
  interface: eth0
```
