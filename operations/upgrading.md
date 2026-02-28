# Upgrading

## Binary Upgrade

1. Build or download the new version
2. Stop the agent: `sudo systemctl stop ebpfsentinel`
3. Replace the binary: `sudo cp ebpfsentinel-agent /usr/local/bin/`
4. Start the agent: `sudo systemctl start ebpfsentinel`

eBPF programs are reloaded automatically on startup.

## Docker Upgrade

```bash
# Pull or build new image
docker build -t ebpfsentinel:new .

# Restart with new image
docker compose down
# Update image tag in docker-compose.yml
docker compose up -d
```

## Kubernetes Upgrade

```bash
# Update image in DaemonSet
kubectl -n ebpfsentinel set image daemonset/ebpfsentinel agent=ebpfsentinel:new

# Or apply updated manifest
kubectl apply -f daemonset.yaml

# Monitor rollout
kubectl -n ebpfsentinel rollout status daemonset/ebpfsentinel
```

The DaemonSet performs a rolling update — one node at a time. During the upgrade, each node has a brief window (~1-2 seconds) where eBPF programs are not attached.

## Configuration Changes

Most configuration changes don't require a restart:

```bash
# Edit config
vim /etc/ebpfsentinel/config.yaml

# Reload without restart
kill -HUP $(pidof ebpfsentinel-agent)
# Or:
curl -X POST http://localhost:8080/api/v1/config/reload
```

## Rollback

Keep the previous binary version:

```bash
sudo cp /usr/local/bin/ebpfsentinel-agent /usr/local/bin/ebpfsentinel-agent.bak
```

Rollback: swap the binary and restart.
