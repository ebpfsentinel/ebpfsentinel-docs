# Replaying a Rule Before It Is Applied

A rule is written against traffic nobody has in front of them. The dashboard
answers the question an architect asks before every change - **what would this
rule have caught yesterday** - by replaying the rule body over events that were
already recorded, and by showing a proposed configuration as a diff against
what the canary runs today.

Two screens carry it: the rule editors (IDS patterns, DLP patterns) offer a
replay of the body being edited, and the rollouts screen shows the diff and the
replay together, for the second operator who has to approve somebody else's
change.

## What a replay is, and what it is not

A replay matches a rule body against **stored events**. It does not load the
rule, it does not touch the datapath, and it cannot see traffic that never
happened.

| It answers | It does not answer |
|------------|--------------------|
| How many recorded events this body would have matched | Whether the kernel will accept the rule |
| Which events those were, with their endpoints and payload excerpt | What the rule costs per packet |
| Which store the reading came out of | What tomorrow's traffic will do |

A rule that replays to zero matches is a rule that matched nothing **in what
was recorded**. That is a reason to look at the window, not a verdict on the
rule.

## The two sources, and why the screen names them

The server reads the forensic history first, which is the last 24 hours of the
whole estate in ClickHouse. When the history is off, it asks the target agent
for its own recent event buffer instead.

| Source | Window | Scope |
|--------|--------|-------|
| Forensic history | The last 24 hours | Every agent of the tenant |
| Agent buffer | However much the agent still holds, typically minutes | The one agent asked |

The screen says which one answered, every time, because a count over a few
minutes of one agent's buffer is not a count over a day of the estate, and
approving a change on the wrong one is the mistake this feature exists to
prevent. A count never appears without its source beside it.

The agent buffer is a fallback the agents do not serve yet: an agent asked for
a replay today answers that it does not know the route, and the screen reports
the agent as unreachable for replay rather than reporting zero matches. With
the forensic history enabled - which is how the console is deployed - the
replay is answered out of ClickHouse and the fallback is never reached.

## Reading the result

Four states, kept apart on purpose, because three of them would otherwise read
as "no matches":

| State | What it means |
|-------|---------------|
| A count and sample events | The store answered and the body matched |
| No recorded event matched | The store answered and the body matched nothing |
| The agent did not answer | Neither store could be read; nothing was measured |
| Your role may not test rules | The session lacks the permission; nothing was asked |

![The IDS rule editor, with a rule body replayed over the recorded window and the reading under it](/img/rule-replay.png)

The reading sits under the rule it is of: the body above it, the store that
answered beside the count, and the caveat under both. The rule above matched
nothing in the window that was recorded, which is a reading rather than a
refusal.

Replays are rate limited to one every two seconds per session, and a body
longer than 8 KiB is refused rather than truncated.

## The diff inside a two-person rollout

A configuration rollout is proposed by one operator and approved by another.
The approver sees, on the rollouts screen:

- **the diff** - the proposed document line by line against what the canary
  runs today, read from the canary itself at the moment the comparison is
  asked for. A section the canary cannot answer for is reported as unreadable
  rather than shown as a rewrite of everything, and a proposal the canary is
  already running says so instead of showing an empty diff;
- **a replay of every rule the proposal carries**, run against the canary, so
  the approver reads the effect of the change and not only its text.

![A rollout awaiting approval, compared with what its canary runs today](/img/rollout-diff.png)

The approver presses one control and reads what the change does to the canary:
here a single threshold, three strikes becoming five, inside a section that is
otherwise unchanged.

The replay beside a rollout carries the same caveat the rule editors do, and
the screen states it next to the result: it reads events that were already
recorded, so it says what these rules would have caught, not what the kernel
does with them once the rollout is applied. Reading a diff and a replay is not
a substitute for the canary stage - that is what the canary stage is for.

## Permissions

| Action | Permission |
|--------|------------|
| Replay a rule body | `TestRules` |
| Propose, approve or roll back a configuration rollout | `PushAgentConfig` |

A session without `TestRules` sees the replay control and the reason it cannot
be used, rather than a control that fails when pressed.
