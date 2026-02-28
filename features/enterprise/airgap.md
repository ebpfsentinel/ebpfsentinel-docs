# Air-Gap Mode

> **Edition: Enterprise** | **Status: Planned**

## Overview

Offline operation for environments without internet access.

## Planned Capabilities

- Local threat intelligence feed bundles (USB/file import)
- Offline feed update workflow with integrity verification
- Local signature database updates
- No outbound network requirements after initial setup

## Current Alternative

Configure threat intelligence feeds with local file URLs instead of remote URLs. Pre-download feed files and serve them from a local HTTP server or file path. The feed configuration is source-agnostic — any URL that returns the expected format works.
