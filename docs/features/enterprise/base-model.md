# The Base Anomaly Model

> **Edition: Enterprise**

## Overview

A new deployment of [ML anomaly detection](ml-detection.md) learns its baseline
on the estate it runs on, which leaves it blind for its learning period. The
base model is what scores in the meantime: a model built by us, delivered as a
signed content set through the [content channel](content-channel.md), versioned,
measured again on each machine before it runs, and rolled back or pinned like
any other set.

This page states what the model is, what it was trained on, what it was measured
against and what it is not claimed to do. Its model card travels with it in the
same signed set, so every figure below can be read off the file the agent runs
rather than off this page.

## What It Is

The model is a Gaussian over the fourteen window features the pipeline computes
every sixty seconds. Each feature is standardised, and the result is whitened by
the inverse Cholesky factor of their covariance, so the squared length of the
model's output is the Mahalanobis distance of a window from ordinary traffic. The
agent scores it as the mean of that squared output, the same way it scores a
reconstruction error, and judges it against its own history as described under
[ONNX Model Inference](ml-detection.md#onnx-model-inference).

It is shipped as an ONNX graph (`base-model.onnx`) beside its model card
(`model-card.json`), and the card's `model_type` is `gaussian-residual`. An agent
that does not run that kind of model refuses it rather than guessing.

## What It Was Trained On

**Synthetic windows, and nothing else.** No customer traffic, no telemetry and no
data collected from any estate was used to train or to measure it. The windows
are drawn by a seeded generator from five traffic profiles - a web server, a
database, a workstation, a DNS resolver and a mail relay - each one a set of
ranges per feature.

The trainer is deterministic: the graph and its card are a function of the
source code and the version number and of nothing else. The release pipeline
rebuilds the model from source and fails if the published bytes differ, so the
claim that no customer data is in it is something the build checks rather than
something we ask you to believe. The card records the generator, the seed, the
window count and the profiles.

## What It Was Measured Against

Before it is published, and again on each machine before it runs, the model is
measured on held-out synthetic windows it was not trained on:

- **A threshold** set on one set of ordinary windows, at the score that leaves
  99.5 % of them below it.
- **A false positive rate** read on a second set of ordinary windows against that
  threshold. A model above 1 % is refused.
- **A detection rate per attack scenario** against the same threshold. Each
  scenario the model is claimed to detect must reach 95 %, or the model is
  refused.

| Scenario | Claimed | What the windows look like |
|----------|---------|----------------------------|
| `port-scan` | Yes | Many destination ports from few sources, small payloads |
| `syn-flood` | Yes | A high packet rate of TCP with almost no payload, from many sources |
| `udp-amplification` | Yes | A high byte rate of large UDP responses |
| `icmp-sweep` | Yes | ICMP towards many destinations |
| `bulk-exfiltration` | No | A sustained byte rate towards few destinations |

The measured figures are in the card's `evaluation` block, scenario by scenario.

## What It Is Not

- **Not a detector of exfiltration.** The `bulk-exfiltration` scenario is measured
  and its figure published, and it is not claimed: a large, steady transfer to a
  single destination looks too much like an ordinary backup or a software update
  for a model of ordinary traffic to tell apart. Data loss is the job of
  [DLP](dlp.md), not of this model.
- **Not a measurement of real-world accuracy.** Every rate on the card is a rate on
  synthetic windows. How the model behaves on your traffic depends on how far
  your traffic is from the profiles it was trained on, which is exactly why the
  estate's own baseline takes over as it learns.
- **Not several models in one.** It knows one cloud of ordinary traffic. A host
  whose normal traffic sits far outside the five profiles will read as anomalous
  until the history it is judged against catches up.
- **Not scoring from its first minute.** Like any model, it scores nothing until
  it has seen enough windows to be warmed up.

## How It Arrives and How It Is Replaced

The model is the `ml-models` set of the content bundle. What the agent checks
before it lets the model score, and what it reports when a check fails, is in
[The Delivered Base Model](ml-detection.md#the-delivered-base-model). In short:

- A model that fails a check never replaces the one running.
- A model file configured on the host with `model_path` always wins, and the
  delivered one is reported as `superseded`.
- `content rollback --set ml-models` returns to the model before, and
  `content pin --set ml-models` holds the one in force while a newer one is
  looked at. Both are described in [the content channel](content-channel.md).

The running model's version and where it came from are in
`GET /api/v1/enterprise/ml/status` as `model_version`, `model_source` and
`delivered_model`, and on the dashboard's ML screen.

## Related

- [ML Anomaly Detection](ml-detection.md)
- [Content Channel](content-channel.md)
- [Sigma Rules](sigma-rules.md)
