# Incident Notification Evidence

Two European texts impose a notification within hours of an incident: the Cyber Resilience Act
(EU 2024/2847) on manufacturers of products with digital elements, and the NIS2 Directive
(EU 2022/2555) on essential and important entities. Both count twenty-four hours to an early
warning and seventy-two hours to a notification. eBPFsentinel does not send either. What it
produces is the [evidence pack](../features/enterprise/cases.md#evidence-pack) (Enterprise), the
record of one case read against those two deadlines, which the person writing the notification
works from.

## What the pack is

- **A case read against the two deadlines.** The marks are counted from the first observation,
  the earliest alert the case holds. Both marks are always present, including one by which
  nothing was known or done, because an empty interval is part of what a notification says.
- **Traceable line by line.** Every alert, act, asset, flow and piece of evidence names the record
  it was read from (`alert:`, `case_event:`, `freeze:`, `capture:`), so any figure in the pack can
  be followed back to the alert or the log row behind it.
- **Honest about what is missing.** No owner, no evidence, an alert with no flow, an alert added
  after a mark it was observed before, a deadline passed with nothing recorded, a capture that
  cannot be verified: each is listed as a gap rather than left for the reader to find.
- **Fileable and reproducible.** The pack downloads as a PDF to keep beside the notification and as
  JSON for a tool. Two exports of the same case log are the same file byte for byte, the PDF
  states the SHA-256 of the JSON export, and each capture carries its SHA-256 and its position in
  the audit chain.

## What the pack is not

- **It is not the notification.** It does not reach a CSIRT, a competent authority, ENISA or the
  CRA single reporting platform, and it does not fill in their forms.
- **It does not decide significance.** Whether an incident is significant under NIS2 Article 23(3),
  or severe under CRA Article 14(5), is the entity's judgement. The pack starts the clock at the
  first observation it holds; the legal clock starts when the entity becomes aware, which may be
  later.
- **It sees what the agents saw.** Impact on service, users affected, cross-border effect, root
  cause and mitigation outside the network are for the entity to state.
- **It does not make anyone compliant.** It is evidence an obligation is met with, and only a part
  of it.

## Obligations it helps with

### Cyber Resilience Act - Article 14

Reporting by manufacturers applies from 11 September 2026, through the single reporting platform
to the CSIRT designated as coordinator and to ENISA. It concerns an actively exploited
vulnerability in the manufacturer's product and a severe incident having an impact on its
security, so the pack is relevant where the case concerns the product or the infrastructure it is
built and run on.

| Provision | Deadline | What the pack contributes | Outside the pack |
|-----------|----------|---------------------------|------------------|
| 14(2)(a), 14(4)(a) | Early warning within 24 hours of awareness | What was known at the 24 hour mark: alerts, acts, evidence, the assets and flows involved | Judging the incident severe, submitting the warning |
| 14(2)(b), 14(4)(b) | Notification within 72 hours of awareness | What was known at the 72 hour mark, the actions taken and by whom | The nature of the incident, its impact, corrective measures offered to users |
| 14(2)(c), 14(4)(c) | Final report within 14 days of a corrective measure (vulnerability) or one month after the notification (incident) | The whole case timeline, the evidence with its digests, the gaps | Root cause, the final description and the measures taken |

### NIS2 Directive - Article 23

| Provision | Deadline | What the pack contributes | Outside the pack |
|-----------|----------|---------------------------|------------------|
| 23(4)(a) | Early warning within 24 hours of awareness | What was known at the 24 hour mark | Judging the incident significant, sending the warning to the CSIRT or authority |
| 23(4)(b) | Incident notification within 72 hours of awareness | What was known at the 72 hour mark, the actions and their actors | The severity and impact assessment |
| 23(4)(c) | Intermediate report on request | The pack as it stands at the moment it is exported | The status update itself |
| 23(4)(d) | Final report within one month of the notification | The whole case timeline, the evidence, the gaps | The detailed description, root cause, mitigation and cross-border impact |

The rest of NIS2's reporting obligations, and the posture controls the
[compliance report](../features/enterprise/compliance-reports.md) judges, are mapped on the
[NIS2 page](nis2.md).

## Producing a pack

1. Open a case over the alerts that make up the incident and keep it worked: owner, notes,
   evidence collected. See [Cases](../features/enterprise/cases.md).
2. Open **Evidence pack** from the case and read the gaps first: each is something the
   notification will have to explain or the case still has time to hold.
3. Download the PDF and the JSON. Keep both: the PDF names the JSON's digest, so either can be
   checked against the other later.

The pack is served by `dashboard-server` under
`/api/v1/{tenant}/cases/{case_id}/evidence-pack`, with `.json` and `.pdf` for the files; the
routes are listed in the [dashboard route surface](../configuration/dashboard.md#route-surface).
Cases need the dashboard's ClickHouse history store.
