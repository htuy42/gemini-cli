/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TaskAgentTool } from './task-agent-tool.js';
import { isAgentSpawnRequest } from '../core/agent-handler.js';
import { Config } from '../config/config.js';
import { convertToFunctionResponse } from '../core/coreToolScheduler.js';

describe('TaskAgent Integration', () => {
  it('should correctly detect agent spawn requests from tool responses', async () => {
    const config = new Config({
      sessionId: 'test-session',
      targetDir: '/tmp',
      debugMode: false,
      cwd: '/tmp',
      model: 'gemini-2.0-flash-latest',
    });
    const tool = new TaskAgentTool(config);
    
    // Execute the tool
    const result = await tool.execute(
      {
        task: 'Test task',
        prompt: 'Test prompt',
        maxTurns: 5,
        timeoutMs: 60000,
      },
      new AbortController().signal,
    );
    
    // Convert to function response as the scheduler would
    const response = convertToFunctionResponse(
      'task_agent',
      'test-call-id',
      result.llmContent,
    );
    
    // Create a tool response info object
    const toolResponse = {
      callId: 'test-call-id',
      responseParts: response,
      resultDisplay: result.returnDisplay,
      error: undefined,
    };
    
    // Check if it's detected as an agent spawn request
    const agentRequest = isAgentSpawnRequest(toolResponse);
    
    expect(agentRequest).not.toBeNull();
    expect(agentRequest?.type).toBe('spawn_agent');
    expect(agentRequest?.task).toBe('Test task');
    expect(agentRequest?.prompt).toBe('Test prompt');
    expect(agentRequest?.maxTurns).toBe(5);
    expect(agentRequest?.timeoutMs).toBe(60000);
  });
  
  it('should return null for non-agent tool responses', () => {
    // Test with a regular tool response
    const regularResponse = {
      callId: 'test-call-id',
      responseParts: {
        functionResponse: {
          id: 'test-call-id',
          name: 'some_other_tool',
          response: { output: 'Regular tool output' },
        },
      },
      resultDisplay: 'Success',
      error: undefined,
    };
    
    const agentRequest = isAgentSpawnRequest(regularResponse);
    expect(agentRequest).toBeNull();
  });
  
  it('should handle various response part formats', () => {
    // Test with text part
    const textPartResponse = {
      callId: 'test-call-id',
      responseParts: [{ text: JSON.stringify({ type: 'spawn_agent', task: 'Test', prompt: 'Test', maxTurns: 5, timeoutMs: 60000 }) }],
      resultDisplay: 'Success',
      error: undefined,
    };
    
    let agentRequest = isAgentSpawnRequest(textPartResponse);
    expect(agentRequest).not.toBeNull();
    expect(agentRequest?.type).toBe('spawn_agent');
    
    // Test with string response
    const stringResponse = {
      callId: 'test-call-id',
      responseParts: JSON.stringify({ type: 'spawn_agent', task: 'Test', prompt: 'Test', maxTurns: 5, timeoutMs: 60000 }),
      resultDisplay: 'Success',
      error: undefined,
    };
    
    agentRequest = isAgentSpawnRequest(stringResponse);
    expect(agentRequest).not.toBeNull();
    expect(agentRequest?.type).toBe('spawn_agent');
  });
});