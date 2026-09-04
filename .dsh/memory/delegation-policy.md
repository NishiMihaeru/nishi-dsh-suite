# Delegation policy

- Do not create nested subagent hierarchies.
- When the top-level agent delegates work, its prompt must explicitly prohibit the child from calling `subagent`, `subagent_fork`, workflows, Ralph, or otherwise delegating further.
- Prefer direct execution by the top-level agent when delegation would add unnecessary nesting.
- If several workers are needed, the top-level agent launches and coordinates them directly as siblings.
- Every `subagent` call must explicitly specify `provider`, `model`, and a supported `reasoning_effort`; never rely on inherited or default routing.
- Before choosing a subagent route, query `list_subagent_models` and use only a provider/model/effort combination advertised as allowed in its current result.