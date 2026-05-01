# Ollama Bridge Auto Orchestrator

## General Idea

Auto Orchestrator would be a virtual model inside Ollama Copilot Bridge.

In Copilot's model picker, it would appear as:

```txt
Ollama Bridge: Auto Orchestrator
```

The user selects that single model, but internally the extension decides which LLM to use for each phase:

```txt
User
-> Auto Orchestrator
-> Analyzer
-> Planner model
-> Implementer model
-> Reviewer model
-> Final response / tool calls
```

The extension does not replace GitHub Copilot Agents. It complements them.

```txt
Copilot Agent = defines the role and behavior
Auto Orchestrator = decides which model to use internally
```

Example:

```txt
PM-Agent + Ollama Bridge: Auto Orchestrator
```

PM-Agent defines the type of work. Auto Orchestrator decides whether to use one model for planning, another for implementation, and another for review.

## Practical Usage

1. Install the extension.

```powershell
code --install-extension .\ollama-copilot-bridge-0.0.3.vsix --force
```

2. Reload VS Code.

3. Configure the API key:

```txt
Ollama Copilot: Set API Key
```

4. Configure the orchestrator models:

```json
{
  "ollamaCopilot.orchestrator.enabled": true,
  "ollamaCopilot.orchestrator.mode": "balanced",
  "ollamaCopilot.orchestrator.simpleModel": "gemma3:12b",
  "ollamaCopilot.orchestrator.plannerModel": "deepseek-v4-pro",
  "ollamaCopilot.orchestrator.implementerModel": "kimi-k2.6",
  "ollamaCopilot.orchestrator.reviewerModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.toolModel": "deepseek-v4-pro"
}
```

5. In Copilot Chat, select:

```txt
Ollama Bridge: Auto Orchestrator
```

6. Use Agent mode normally.

Example:

```txt
Refactor this module, separate the authentication logic, add tests, and run the suite.
```

Internally:

```txt
Analyzer: complex
Planner: deepseek-v4-pro
Implementer: kimi-k2.6
Reviewer: gpt-oss:120b
Tool model: deepseek-v4-pro if tools are needed
```

The user only sees a normal conversation.

## Execution Routes

### Simple Task

Example:

```txt
Fix this typo in README.
```

Route:

```txt
User -> simpleModel -> final
```

### Medium Task

Example:

```txt
Add a new setting and update the README.
```

Route:

```txt
User -> plannerModel -> implementerModel -> final
```

### Complex Task

Example:

```txt
Restructure the provider to support multiple endpoints, tests, and fallback.
```

Route:

```txt
User -> plannerModel -> implementerModel -> reviewerModel -> final
```

### Risky Task

Example:

```txt
Modify authentication, secrets, permissions, or command execution.
```

Route:

```txt
User -> plannerModel -> implementerModel -> reviewerModel -> tests -> final
```

## Complexity Classifier

The analyzer decides the route based on the task.

Criteria:

```txt
simple:
- small change
- one file
- no tests required
- no complex tools required

medium:
- multiple files
- new configuration
- small UI changes
- tests recommended

complex:
- refactor
- architecture
- multiple modules
- provider/API changes
- requires a plan

risky:
- authentication
- secrets
- security
- commands/terminal
- sensitive data
- destructive changes
```

It can also detect manual overrides in the prompt:

```txt
Use fast mode
Use thorough mode
Use only Kimi
Use strong planner
Do not review
```

## Recommended Configuration

```json
{
  "ollamaCopilot.orchestrator.enabled": true,
  "ollamaCopilot.orchestrator.mode": "balanced",
  "ollamaCopilot.orchestrator.maxSteps": 3,
  "ollamaCopilot.orchestrator.maxPlanningTokens": 1500,
  "ollamaCopilot.orchestrator.maxReviewTokens": 1000,
  "ollamaCopilot.orchestrator.showTraceInChat": true,
  "ollamaCopilot.orchestrator.autonomy": "ask-before-tools",
  "ollamaCopilot.orchestrator.simpleModel": "gemma3:12b",
  "ollamaCopilot.orchestrator.plannerModel": "deepseek-v4-pro",
  "ollamaCopilot.orchestrator.plannerFallbackModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.implementerModel": "kimi-k2.6",
  "ollamaCopilot.orchestrator.implementerFallbackModel": "deepseek-v4-pro",
  "ollamaCopilot.orchestrator.reviewerModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.toolModel": "deepseek-v4-pro"
}
```

## Modes

### fast

Fewer steps. Lower cost and lower latency.

```txt
simple -> simpleModel
medium -> implementerModel
complex -> plannerModel -> implementerModel
```

### balanced

Balance between quality and speed.

```txt
simple -> simpleModel
medium -> plannerModel -> implementerModel
complex -> plannerModel -> implementerModel -> reviewerModel
```

### thorough

Slower, but more careful.

```txt
simple -> implementerModel
medium -> plannerModel -> implementerModel -> reviewerModel
complex -> plannerModel -> implementerModel -> reviewerModel -> tests
risky -> plannerModel -> reviewerModel -> implementerModel -> reviewerModel -> tests
```

## Tool Calling

Auto Orchestrator must control which phases can use tools.

Recommended rule:

```txt
Analyzer: no tools
Planner: optional read-only tools
Implementer: tools enabled
Reviewer: read-only tools + terminal tests
```

If the selected implementation model does not support tools:

```txt
1. Try implementerModel
2. If it does not return tool_calls, use toolModel
3. If toolModel fails, respond with a plan/manual steps
```

The extension should already convert:

```txt
OpenAI/Ollama tool_calls -> VS Code LanguageModelToolCallPart
VS Code LanguageModelToolResultPart -> OpenAI role: tool
```

VS Code/Copilot still controls actual tool execution and confirmations.

## Logs And Traceability

The Output Channel should show:

```txt
[Orchestrator] phase=analyze model=gemma3:12b status=ok duration=1.2s
[Orchestrator] complexity=complex route=planner->implementer->reviewer
[Orchestrator] phase=plan model=deepseek-v4-pro status=ok duration=5.8s
[Orchestrator] phase=implement model=kimi-k2.6 status=tool_call runCommand
[Orchestrator] phase=review model=gpt-oss:120b status=ok duration=7.1s
```

Recommended command:

```txt
Ollama Copilot: Show Orchestrator Trace
```

Optional line shown in chat:

```txt
Using: Planner DeepSeek V4 Pro -> Coder Kimi K2.6 -> Reviewer GPT-OSS 120B
```

Configurable with:

```json
{
  "ollamaCopilot.orchestrator.showTraceInChat": true
}
```

## Downsides And Solutions

### 1. Higher Latency

Problem:

```txt
analyzer -> planner -> implementer -> reviewer
```

can take longer.

Solution:

```txt
fast mode
complexity-based routing
skip planner/reviewer for simple tasks
maxSteps
```

### 2. Higher Cost Or Quota Usage

Problem: multiple calls consume more tokens.

Solution:

```json
{
  "ollamaCopilot.orchestrator.maxSteps": 3,
  "ollamaCopilot.orchestrator.maxPlanningTokens": 1500,
  "ollamaCopilot.orchestrator.maxReviewTokens": 1000
}
```

### 3. Loss Of Coherence Between Models

Problem: the planner says one thing and the implementer understands another.

Solution: convert the plan into a contract.

Format:

```txt
Goal:
Files:
Steps:
Constraints:
Tests:
Do not:
```

The implementer receives:

```txt
Implement exactly this plan.
Do not change unrelated files.
If a step is impossible, explain why.
```

### 4. Messy Tool Calling

Problem: any phase could try to execute tools.

Solution:

```txt
toolsEnabled = phase === "implement" || phase === "review"
```

### 5. Harder Debugging

Problem: many pieces can fail.

Solution:

```txt
Output Channel trace
duration per phase
model used per phase
status per phase
last error per phase
```

### 6. Confusion Because The Picker Does Not Change

Problem: the user only sees:

```txt
Ollama Bridge: Auto Orchestrator
```

Solution:

```txt
showTraceInChat
Show Orchestrator Trace command
Output Channel logs
```

### 7. Models Without Real Tool Calling

Problem: some models claim to support tools but do not return `tool_calls`.

Solution:

```txt
dedicated toolModel
fallback when there are no tool_calls
capability checks
local list of reliable models
```

### 8. Intermediate Model Failures

Problem: planner/implementer/reviewer may fail due to timeout, 503, or overload.

Solution:

```json
{
  "ollamaCopilot.orchestrator.plannerFallbackModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.implementerFallbackModel": "deepseek-v4-pro"
}
```

Rules:

```txt
planner fails -> use plannerFallback
implementer fails -> use implementerFallback
reviewer fails -> continue without reviewer
```

### 9. Too Much Autonomy

Problem: the orchestrator could do more than expected.

Solution:

```json
{
  "ollamaCopilot.orchestrator.autonomy": "ask-before-tools"
}
```

Options:

```txt
chat-only = only responds
ask-before-tools = asks for confirmation before tools
agent = uses tools as Agent mode allows
```

### 10. Wrong Model Choice

Problem: the classifier can be wrong.

Solution:

```txt
manual override in the prompt
settings per phase
fallback per phase
logs to review decisions
```

## Recommended MVP

First version:

```txt
Auto Orchestrator
|- mode: fast | balanced | thorough
|- maxSteps
|- simpleModel
|- plannerModel
|- implementerModel
|- reviewerModel
|- toolModel
|- fallbackModels
|- showTraceInChat
|- output trace
```

No advanced UI at first. Only JSON settings, logs, and tests.

Later, add:

```txt
Ollama Copilot: Configure Orchestrator
```

with a menu to choose available models.

## Implementation Plan

### Phase 1: Configuration

- Add orchestrator settings in `package.json`.
- Create `OrchestratorConfig` types.
- Read config from `src/config.ts`.

### Phase 2: Virtual Model

- Add `Ollama Bridge: Auto Orchestrator` to the model list.
- Mark it with `id: auto-orchestrator`.
- Do not send it directly to Ollama.

### Phase 3: Analyzer

- Create `src/orchestrator/analyzer.ts`.
- Classify complexity with local heuristics.
- Optionally use `simpleModel` for advanced classification.

### Phase 4: Pipeline

- Create `src/orchestrator/orchestrator.ts`.
- Implement routes:

```txt
simple -> simpleModel
medium -> planner -> implementer
complex -> planner -> implementer -> reviewer
risky -> planner -> implementer -> reviewer + tests
```

### Phase 5: Internal Client

- Add a non-stream or accumulated-stream request method to `OllamaClient`.
- Allow internal calls per phase.

### Phase 6: Tool Calling

- Reuse `openAiStream.ts`.
- Emit tool calls only from authorized phases.
- Send tool results back to the correct model.

### Phase 7: Traceability

- Add logs per phase.
- Add command `Ollama Copilot: Show Orchestrator Trace`.
- Add `showTraceInChat`.

### Phase 8: Tests

Recommended tests:

```txt
classifies simple task
classifies complex task
chooses route by mode
uses fallback if planner fails
uses toolModel if implementer does not support tools
does not duplicate tool results
generates trace
```

## Expected Result

The user works like this:

```txt
1. Select PM-Agent, Backend-Agent, Reviewer-Agent, etc.
2. Select Ollama Bridge: Auto Orchestrator as the model.
3. Ask for the task normally.
4. The extension decides which LLM to use per phase.
5. Copilot/VS Code runs tools when appropriate.
6. The user receives a final response with the plan, changes, or tool calls.
```

Copilot Agents still work. Auto Orchestrator only improves the internal model selection.
