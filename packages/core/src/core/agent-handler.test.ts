/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { isAgentSpawnRequest, formatAgentResult } from './agent-handler.js';
import { ToolCallResponseInfo } from './turn.js';

describe('agent-handler', () => {
  describe('isAgentSpawnRequest', () => {
    it('should detect spawn_agent response with Part array', () => {
      const response: ToolCallResponseInfo = {
        callId: 'test-id',
        responseParts: [{
          text: JSON.stringify({
            type: 'spawn_agent',
            task: 'Test task',
            prompt: 'Test prompt',
            maxTurns: 20,
            timeoutMs: 300000,
          }),
        }],
        resultDisplay: undefined,
        error: undefined,
      };

      const result = isAgentSpawnRequest(response);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('spawn_agent');
      expect(result?.task).toBe('Test task');
      expect(result?.prompt).toBe('Test prompt');
    });

    it('should detect spawn_agent response with single Part', () => {
      const response: ToolCallResponseInfo = {
        callId: 'test-id',
        responseParts: {
          text: JSON.stringify({
            type: 'spawn_agent',
            task: 'Single task',
            prompt: 'Single prompt',
            maxTurns: 10,
            timeoutMs: 60000,
          }),
        },
        resultDisplay: undefined,
        error: undefined,
      };

      const result = isAgentSpawnRequest(response);
      expect(result).not.toBeNull();
      expect(result?.task).toBe('Single task');
    });

    it('should return null for non-agent responses', () => {
      const response: ToolCallResponseInfo = {
        callId: 'test-id',
        responseParts: [{
          text: JSON.stringify({
            type: 'regular_response',
            data: 'some data',
          }),
        }],
        resultDisplay: undefined,
        error: undefined,
      };

      const result = isAgentSpawnRequest(response);
      expect(result).toBeNull();
    });

    it('should handle string parts', () => {
      const response: ToolCallResponseInfo = {
        callId: 'test-id',
        responseParts: 'Just a string response',
        resultDisplay: undefined,
        error: undefined,
      };

      const result = isAgentSpawnRequest(response);
      expect(result).toBeNull();
    });

    it('should handle invalid JSON gracefully', () => {
      const response: ToolCallResponseInfo = {
        callId: 'test-id',
        responseParts: [{
          text: 'Not valid JSON',
        }],
        resultDisplay: undefined,
        error: undefined,
      };

      const result = isAgentSpawnRequest(response);
      expect(result).toBeNull();
    });
  });

  describe('formatAgentResult', () => {
    it('should format successful agent result', () => {
      const result = formatAgentResult('Test task', {
        success: true,
        description: 'Successfully completed the task',
        result: 'Here are the findings',
      });

      expect(result.role).toBe('model');
      expect(result.parts).toHaveLength(1);
      const text = (result.parts![0] as { text: string }).text;
      expect(text).toContain('Test task');
      expect(text).toContain('Success: true');
      expect(text).toContain('Successfully completed the task');
      expect(text).toContain('Here are the findings');
    });

    it('should format failed agent result', () => {
      const result = formatAgentResult('Failed task', {
        success: false,
        description: 'Failed to complete due to error',
        result: '',
      });

      const text = (result.parts![0] as { text: string }).text;
      expect(text).toContain('Failed task');
      expect(text).toContain('Success: false');
      expect(text).toContain('Failed to complete due to error');
      expect(text).not.toContain('Result:'); // Empty result should not show Result section
    });

    it('should handle missing result', () => {
      const result = formatAgentResult('Task', undefined);

      expect(result.role).toBe('model');
      const text = (result.parts![0] as { text: string }).text;
      expect(text).toBe('Agent execution failed with no result.');
    });
  });
});