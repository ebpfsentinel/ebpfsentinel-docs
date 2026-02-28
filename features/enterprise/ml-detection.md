# ML Anomaly Detection

> **Edition: Enterprise** | **Status: Planned**

## Overview

Machine learning-based behavioral anomaly detection that identifies threats without signature rules.

## Planned Capabilities

- Baseline traffic profiling (normal behavior learning)
- Anomaly scoring for deviations from baseline
- Unsupervised detection of novel attack patterns
- Integration with IDS/IPS for automatic rule generation
- Model retraining on labeled false positives

## Current Alternative

Use IDS threshold detection (limit, threshold, combined modes) with tuned parameters to detect volumetric anomalies. Configure low-severity alert rules with broad patterns for visibility, then refine based on observed traffic.
