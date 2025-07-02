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

When you have completed your task OR if you are running out of time, use the 'return_from_task' tool with:
- success: whether you completed the task successfully
- description: 2-3 sentence summary of what you did
- result: any data the main conversation needs (can be substantial if needed, such as code, analysis, or detailed findings)

Focus only on your assigned task. Be efficient and direct.`;

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