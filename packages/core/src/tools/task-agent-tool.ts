/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { BaseTool, ToolResult } from './tools.js';

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
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    // The TaskAgentTool doesn't actually run the agent itself.
    // Instead, it returns a special marker that the conversation runner
    // can detect and handle by spawning an agent.
    
    const agentRequest = {
      type: 'spawn_agent',
      task: params.task,
      prompt: params.prompt,
      maxTurns: params.maxTurns ?? 20,
      timeoutMs: params.timeoutMs ?? 300000,
    };
    
    return {
      llmContent: [{ text: JSON.stringify(agentRequest) }],
      returnDisplay: `Spawning task agent for: ${params.task}`,
    };
  }
}