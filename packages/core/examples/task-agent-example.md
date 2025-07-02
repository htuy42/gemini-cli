# Task Agent Example

This example demonstrates how the task agent functionality works in Gemini CLI.

## How it works

1. The main conversation can spawn a task agent using the `task_agent` tool
2. The agent runs independently with its own conversation context
3. The agent has access to all the same tools as the main conversation
4. The agent reports back its results when done

## Example Usage

### Main Conversation
```
User: I need you to analyze all the TypeScript files in the project and create a summary of the main components. Use a task agent for this.

Gemini: I'll spawn a task agent to analyze all TypeScript files and create a summary of the main components.

[Uses task_agent tool with task="Analyze TypeScript files and summarize components"]
```

### Agent Execution (happens in background)
```
🤖 Spawning task agent for: "Analyze TypeScript files and summarize components"
📋 Instructions: Find all TypeScript files in the project, analyze their structure...

⚡ Agent is working... (max 20 turns, timeout: 300s)
⚡ Agent executing tools: glob
⚡ Agent thinking: Found 45 TypeScript files. Let me analyze the main ones...
⚡ Agent executing tools: read_file
...
✅ Agent completed: Successfully analyzed 45 TypeScript files and identified 12 main components

Task Agent completed task: "Analyze TypeScript files and summarize components"
Success: true
Summary: Successfully analyzed 45 TypeScript files and identified 12 main components

Result:
## TypeScript Component Summary

### Core Components (5)
1. **GeminiClient** (`src/core/client.ts`) - Main API client for Gemini
2. **TaskAgentRunner** (`src/core/task-agent-runner.ts`) - Executes task agents
3. **CoreToolScheduler** (`src/core/coreToolScheduler.ts`) - Manages tool execution
4. **Config** (`src/config/config.ts`) - Configuration management
5. **Turn** (`src/core/turn.ts`) - Manages conversation turns

### UI Components (4)
1. **App** (`src/ui/App.tsx`) - Main React application
2. **GeminiMessage** (`src/ui/components/messages/GeminiMessage.tsx`) - Message display
3. **ToolMessage** (`src/ui/components/messages/ToolMessage.tsx`) - Tool output display
4. **InputPrompt** (`src/ui/components/InputPrompt.tsx`) - User input handling

### Tool Components (3)
1. **FileTool** (`src/tools/file-tool/file-tool.ts`) - File operations
2. **TaskAgentTool** (`src/tools/task-agent-tool.ts`) - Spawns task agents
3. **Shell** (`src/tools/shell.ts`) - Shell command execution

Total lines of TypeScript code: ~15,000
```

## Benefits

1. **Parallel Processing**: Agents can work on complex tasks without blocking the main conversation
2. **Clean Context**: Each agent starts with a focused context for its specific task
3. **Resource Management**: Agents have timeouts and turn limits to prevent runaway execution
4. **Clear Results**: Agents provide structured results that integrate seamlessly back into the main conversation

## Implementation Details

- Agents receive a copy of the conversation history up to the spawn point
- They have their own tool execution context
- Results are automatically formatted and returned to the main conversation
- Visual indicators show when agents are running and what they're doing