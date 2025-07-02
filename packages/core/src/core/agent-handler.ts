/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolCallResponseInfo } from './turn.js';
import { Config } from '../config/config.js';
import { GeminiClient } from './client.js';
import { TaskAgentRunner } from './task-agent-runner.js';
import { getCoreSystemPrompt } from './prompts.js';
import { Content } from '@google/genai';

export interface AgentSpawnRequest {
  type: 'spawn_agent';
  task: string;
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface AgentHandlerResult {
  isAgent: boolean;
  result?: {
    success: boolean;
    description: string;
    result: string;
  };
}

/**
 * Checks if a tool response is a request to spawn an agent
 */
export function isAgentSpawnRequest(response: ToolCallResponseInfo): AgentSpawnRequest | null {
  try {
    // Check if the response contains our agent spawn marker
    if (response.responseParts) {
      // responseParts is PartListUnion which can be Part or Part[]
      const parts = Array.isArray(response.responseParts) 
        ? response.responseParts 
        : [response.responseParts];
      
      if (parts.length > 0) {
        const firstPart = parts[0];
        // Handle different part types
        let text: string | undefined;
        if (typeof firstPart === 'string') {
          text = firstPart;
        } else if (typeof firstPart === 'object' && 'text' in firstPart) {
          text = firstPart.text;
        }
        
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed.type === 'spawn_agent') {
            return parsed as AgentSpawnRequest;
          }
        }
      }
    }
  } catch {
    // Not an agent spawn request
  }
  return null;
}

/**
 * Handles agent spawning and execution
 */
export async function handleAgentSpawn(
  config: Config,
  client: GeminiClient,
  request: AgentSpawnRequest,
  currentHistory: Content[],
): Promise<AgentHandlerResult> {
  try {
    // Create agent system prompt
    const baseSystemPrompt = getCoreSystemPrompt(config.getUserMemory());
    const agentSystemPrompt = `${baseSystemPrompt}

---

You are a task agent spawned to complete a specific task.

Your task: ${request.task}

Detailed instructions: ${request.prompt}

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

    // Create and run the agent
    const contentGenerator = client.getContentGenerator();
    const runner = new TaskAgentRunner(
      config,
      contentGenerator,
      currentHistory,
      agentSystemPrompt,
    );
    
    const result = await runner.run(
      request.task,
      request.prompt,
      request.maxTurns,
      request.timeoutMs,
    );
    
    return {
      isAgent: true,
      result,
    };
  } catch (error) {
    // Handle agent execution errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      isAgent: true,
      result: {
        success: false,
        description: `Agent failed to execute: ${errorMessage}`,
        result: '',
      },
    };
  }
}

/**
 * Formats agent result for the main conversation
 */
export function formatAgentResult(task: string, result: AgentHandlerResult['result']): Content {
  if (!result) {
    return {
      role: 'model',
      parts: [{ text: 'Agent execution failed with no result.' }],
    };
  }
  
  const message = `Task Agent completed task: "${task}"
Success: ${result.success}
Summary: ${result.description}
${result.result ? `\nResult:\n${result.result}` : ''}`;
  
  return {
    role: 'model',
    parts: [{ text: message }],
  };
}