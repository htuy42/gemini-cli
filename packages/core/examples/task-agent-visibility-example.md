# Task Agent Visibility Example

This example demonstrates the improved visibility features for task agents that show the agent's activities in the tool result.

## Example Usage

When you use the task_agent tool, you'll now see detailed activity logs showing what the agent is doing:

```typescript
// Using the task_agent tool
const result = await task_agent({
  task: "Find and analyze all TypeScript test files",
  prompt: "Use glob to find all *.test.ts files, then read the first one and summarize its structure.",
  maxTurns: 10
});
```

## Example Output

The tool result will now include an activity log showing:

```
Task Agent completed task: "Find and analyze all TypeScript test files"
Success: true
Summary: Successfully found 52 TypeScript test files and analyzed the structure of the first one (config.test.ts).

Result:
Found 52 TypeScript test files in the project. The first test file (src/config/config.test.ts) contains:
- Tests for the Config class
- 18 test cases covering various configuration scenarios
- Tests for API key handling, model selection, and configuration validation

Agent Activity:
  - Starting task: Find and analyze all TypeScript test files
  - Agent thinking: I'll help you find and analyze all TypeScript test files. Let me start by...
  - Agent calling glob: {"pattern":"**/*.test.ts"}
  - glob result: /home/htuy/gcli/gemini-cli/packages/core/src/config/config.test.ts /home/htuy/gcli...
  - Agent thinking: I found 52 TypeScript test files. Now let me read the first one to analyze...
  - Agent calling read_file: {"file_path":"/home/htuy/gcli/gemini-cli/packages/core/src/config/config.test.ts"}
  - read_file result: /** * @license * Copyright 2025 Google LLC * SPDX-License-Identifier: Apache-2.0...
  - Agent calling return_from_task: {"success":true,"description":"Successfully found 52 TypeScript test files..."}
  - Agent returning with results
  - Task completed: Success
```

## Key Improvements

1. **Real-time Status Updates**: The agent now provides status updates as it works, showing:
   - What the agent is thinking (first 150 characters)
   - Which tools it's calling and with what parameters
   - The results of each tool call
   - When the agent is returning with results

2. **Comprehensive Activity Log**: All status updates are collected and included in the final tool result, giving you a complete view of what the agent did.

3. **Better Error Visibility**: If tools fail or errors occur, you'll see them in the activity log, making debugging easier.

## Implementation Details

The visibility improvements are implemented by:

1. Passing a status update callback function to the `TaskAgentRunner`
2. The runner calls this function at key points:
   - Task start
   - Agent thinking (model response preview)
   - Tool execution (name and parameters)
   - Tool results (success or error)
   - Task completion
3. The `TaskAgentTool` collects all status updates and includes them in the final result

This makes sub-agent execution much more transparent and easier to debug.