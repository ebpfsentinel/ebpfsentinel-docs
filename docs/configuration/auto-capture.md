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
| `min_severity` | string | `"high"` | Minimum alert severity to trigger capture: `low`, `medium`, `high`, `critical`. Any other word is refused at startup |
| `components` | list | `[]` | Component filter (e.g., `[ids, ddos]`). Empty matches all capturable components; see below for the accepted names |
| `duration_secs` | u64 | `30` | Capture duration in seconds (max 60 in OSS) |
| `snap_length` | u32 | `1500` | Snap length in bytes (maximum bytes captured per packet) |
| `interface` | string | `null` | Interface to capture on. If omitted, uses the first agent interface |

## What can be captured

The BPF filter is built from the address the alert names, so a component whose
alerts carry none has nothing to capture on. DLP matches and ML anomalies are
process-level, and DNS and routing alerts describe a name or a gateway rather
than a peer. `components` therefore accepts only the components whose alerts
name a source:

`ai-security`, `ddos`, `firewall`, `ids`, `ips`, `l7`, `ratelimit`,
`threatintel`

Any other name is refused at startup rather than accepted as a filter that
would never match, and an alert of an accepted component that still names no
source is skipped at the moment it fires.

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
