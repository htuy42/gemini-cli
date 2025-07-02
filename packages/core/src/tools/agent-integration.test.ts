/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TaskAgentTool } from './task-agent-tool.js';
import { ReturnFromTaskTool } from './return-from-task-tool.js';
import { isAgentSpawnRequest } from '../core/agent-handler.js';

describe('Agent Integration', () => {
  it('should create proper spawn request with TaskAgentTool', async () => {
    const tool = new TaskAgentTool({} as any);
    
    const result = await tool.execute({
      task: 'Research authentication methods',
      prompt: 'Find the best authentication approach for our API',
      maxTurns: 10,
      timeoutMs: 30000,
    }, new AbortController().signal);

    // Check the result contains spawn marker
    expect(result.llmContent).toBeTruthy();
    expect(Array.isArray(result.llmContent)).toBe(true);
    const parts = result.llmContent as any[];
    expect(parts[0].text).toBeTruthy();
    const parsed = JSON.parse(parts[0].text);
    expect(parsed.type).toBe('spawn_agent');
    expect(parsed.task).toBe('Research authentication methods');
    expect(parsed.prompt).toBe('Find the best authentication approach for our API');
  });

  it('should detect spawn request correctly', () => {
    const response = {
      responseParts: [{
        text: JSON.stringify({
          type: 'spawn_agent',
          task: 'Test task',
          prompt: 'Test prompt',
          maxTurns: 5,
          timeoutMs: 60000,
        })
      }]
    };

    const request = isAgentSpawnRequest(response as any);
    expect(request).toBeTruthy();
    expect(request?.task).toBe('Test task');
    expect(request?.prompt).toBe('Test prompt');
  });

  it('should create proper return with ReturnFromTaskTool', async () => {
    const tool = new ReturnFromTaskTool();
    
    const result = await tool.execute({
      success: true,
      description: 'Completed the research successfully',
      result: 'Found OAuth2 and JWT as best options',
    }, new AbortController().signal);

    // Check the result contains return marker
    expect(result.llmContent).toBeTruthy();
    expect(Array.isArray(result.llmContent)).toBe(true);
    const parts = result.llmContent as any[];
    expect(parts[0].text).toBeTruthy();
    const parsed = JSON.parse(parts[0].text);
    expect(parsed.type).toBe('agent_return');
    expect(parsed.success).toBe(true);
    expect(parsed.description).toBe('Completed the research successfully');
    expect(parsed.result).toBe('Found OAuth2 and JWT as best options');
  });

  it('should validate parameters correctly', async () => {
    const agentTool = new TaskAgentTool({} as any);
    const returnTool = new ReturnFromTaskTool();

    // TaskAgentTool allows missing params (has defaults)
    const result1 = await agentTool.execute({
      task: 'Test task',
      prompt: 'Test prompt'
    }, new AbortController().signal);
    expect(result1).toBeTruthy();
    
    // ReturnFromTaskTool doesn't validate params (it just passes them through)
    const result2 = await returnTool.execute({
      success: true,
      description: '',
      result: ''
    }, new AbortController().signal);
    expect(result2).toBeTruthy();
    const parts2 = result2.llmContent as any[];
    const parsed2 = JSON.parse(parts2[0].text);
    expect(parsed2.success).toBe(true);
    expect(parsed2.description).toBe('');
    expect(parsed2.result).toBe('');
  });
});