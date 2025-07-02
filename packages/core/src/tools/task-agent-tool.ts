/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { BaseTool, ToolResult } from './tools.js';
import { TaskAgentRunner } from '../core/task-agent-runner.js';
import { getSubAgentSystemPrompt } from '../core/prompts.js';
import { Content } from '@google/genai';

export interface TaskAgentParams {
  task: string;
  prompt: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface TaskAgentResult {
  success: boolean;
  description: string;
  result: string;
}

export class TaskAgentTool extends BaseTool<TaskAgentParams, ToolResult> {
  static readonly Name = 'task_agent';
  
  constructor(private config: Config) {
    super(
      TaskAgentTool.Name,
      'TaskAgent',
      'Spawn a task agent to handle a specific sub-task. The agent will have access to the conversation history and can use tools to complete its task. It will return a summary of what it did and any results.',
      {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Brief description of the task (1-2 sentences)',
          },
          prompt: {
            type: 'string',
            description: 'Detailed instructions for the agent on how to complete the task',
          },
          maxTurns: {
            type: 'number',
            description: 'Maximum number of turns the agent can take (default: 20)',
          },
          timeoutMs: {
            type: 'number',
            description: 'Maximum time in milliseconds for the agent to complete (default: 300000 / 5 minutes)',
          },
        },
        required: ['task', 'prompt'],
      },
    );
  }

  async execute(
    params: TaskAgentParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    try {
      // Create agent system prompt
      const baseSystemPrompt = getSubAgentSystemPrompt(this.config.getUserMemory());
      const agentSystemPrompt = `${baseSystemPrompt}

---

You are a task agent spawned to complete a specific task.

Your task: ${params.task}

Detailed instructions: ${params.prompt}

## Error Recovery and Adaptation

When encountering errors or unexpected results:

1. **Analyze the Error**: Read error messages carefully. They often contain:
   - Specific file paths or line numbers
   - Missing dependencies or permissions issues  
   - Syntax problems or type mismatches
   - Suggestions for fixes

2. **Verify Current State**: Before retrying, check what actually happened:
   - Use 'ls' to verify file/directory existence
   - Use 'read_file' to check file contents
   - Use 'shell' with simple commands to test assumptions

3. **Adapt Your Strategy**: If an approach fails twice with the same error:
   - Try a different tool (e.g., 'shell' for complex operations vs 'write_file' for simple ones)
   - Break the operation into smaller steps
   - Check for common issues:
     * Missing parent directories → create them first
     * Permission errors → try a different location or approach
     * Command not found → check if tool/binary exists first
     * File not found → verify the exact path with 'ls'

4. **Track Your Progress**: After each successful step:
   - Verify the change took effect (read the file, list directory, etc.)
   - Update your task list if using one
   - Note what worked for similar future operations

## Common Recovery Patterns

- **File not found**: Use 'ls' to explore directory structure, check for typos
- **Permission denied**: Often means read-only file or directory - note this limitation
- **Command failed**: Try with simpler arguments, check syntax, or use 'shell' to debug
- **Edit/Replace failed**: Read the file first to see exact content, ensure unique match strings
- **Module/Import errors**: Check if dependencies are installed, verify import paths

## When to Return

Use 'return_from_task' when:
- Task is successfully completed
- You've encountered an insurmountable blocker (after trying alternatives)
- Time is running out (you'll see a warning)
- The task requirements are unclear and you've made your best attempt

Always include in your return:
- What you accomplished (even if partial)
- Any blockers or errors you couldn't resolve
- Suggestions for next steps if the task was not fully completed

Focus on your assigned task. Be efficient, direct, and resilient.`;

      // Get the current conversation history from the GeminiClient
      const geminiClient = this.config.getGeminiClient();
      const currentHistory = await geminiClient.getHistory();
      
      // Get the content generator from config
      const { createContentGenerator } = await import('../core/contentGenerator.js');
      const contentGenerator = createContentGenerator(this.config);
      
      // Create and run the agent
      const runner = new TaskAgentRunner(
        this.config,
        contentGenerator,
        currentHistory,
        agentSystemPrompt,
        undefined, // No status updates needed for synchronous execution
      );
      
      const result = await runner.run(
        params.task,
        params.prompt,
        params.maxTurns ?? 20,
        params.timeoutMs ?? 300000,
      );
      
      // Format the result as a regular tool response
      const resultText = `Task Agent completed task: "${params.task}"
Success: ${result.success}
Summary: ${result.description}
${result.result ? `\nResult:\n${result.result}` : ''}`;
      
      return {
        llmContent: [{ text: resultText }],
        returnDisplay: resultText,
      };
    } catch (error) {
      // Handle agent execution errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorText = `Task Agent failed to execute: ${errorMessage}`;
      
      return {
        llmContent: [{ text: errorText }],
        returnDisplay: errorText,
      };
    }
  }
}