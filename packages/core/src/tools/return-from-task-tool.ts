/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';

export interface ReturnFromTaskParams {
  success: boolean;
  description: string;
  result: string;
}

export class ReturnFromTaskTool extends BaseTool<ReturnFromTaskParams, ToolResult> {
  static readonly Name = 'return_from_task';
  
  constructor() {
    super(
      ReturnFromTaskTool.Name,
      'ReturnFromTask',
      'Return from a task agent with results. This tool is only available to task agents and signals completion of their assigned task.',
      {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            description: 'Whether the task was completed successfully',
          },
          description: {
            type: 'string',
            description: 'A 2-3 sentence summary of what was accomplished',
          },
          result: {
            type: 'string',
            description: 'Any data or findings to return to the main conversation. Can be substantial (code, analysis, detailed findings, etc.)',
          },
        },
        required: ['success', 'description', 'result'],
      },
    );
  }
  
  async execute(
    params: ReturnFromTaskParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    // This tool will signal to the agent runner that the agent is done
    // The actual handling will be in the agent execution logic
    
    // For now, we'll return a special result that the agent runner can detect
    return {
      llmContent: [{ text: JSON.stringify({
        type: 'agent_return',
        ...params,
      }) }],
      returnDisplay: `${params.success ? '✅' : '❌'} Task ${params.success ? 'completed' : 'failed'}: ${params.description}`,
    };
  }
}