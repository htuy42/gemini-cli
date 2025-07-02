/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskAgentRunner } from './task-agent-runner.js';
import { Config } from '../config/config.js';
import { ContentGenerator } from './contentGenerator.js';
import { GeminiChat } from './geminiChat.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { ReturnFromTaskTool } from '../tools/return-from-task-tool.js';
import { GeminiEventType } from './turn.js';

// Mock modules
vi.mock('./geminiChat.js');
vi.mock('../tools/tool-registry.js');
vi.mock('./prompts.js', () => ({
  getCoreSystemPrompt: vi.fn(() => 'Base system prompt'),
}));

describe('TaskAgentRunner', () => {
  let config: Config;
  let contentGenerator: ContentGenerator;
  let mockGeminiChat: any;
  let mockToolRegistry: any;
  let parentRegistry: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    parentRegistry = {
      getAllTools: vi.fn(() => []),
      registerTool: vi.fn(),
      getTool: vi.fn(),
    };
    
    config = {
      getToolRegistry: vi.fn(() => Promise.resolve(parentRegistry)),
      getUserMemory: vi.fn(() => 'User memory content'),
      getTargetDir: vi.fn(() => '/test/dir'),
      getCoreTools: vi.fn(() => undefined),
      getExcludeTools: vi.fn(() => undefined),
      getFileService: vi.fn(() => ({
        getGeminiIgnorePatterns: vi.fn(() => []),
      })),
    } as any;
    
    contentGenerator = {} as any;
    
    mockToolRegistry = {
      getAllTools: vi.fn(() => []),
      registerTool: vi.fn(),
      getTool: vi.fn(),
      discoverTools: vi.fn(() => Promise.resolve()),
    };
    
    // Mock ToolRegistry constructor
    vi.mocked(ToolRegistry).mockImplementation(() => mockToolRegistry);
    
    mockGeminiChat = {
      getHistory: vi.fn(() => []),
    };
    
    vi.mocked(GeminiChat).mockImplementation(() => mockGeminiChat);
  });

  it('should properly detect agent return from return_from_task tool', async () => {
    const runner = new TaskAgentRunner(
      config,
      contentGenerator,
      [],
      'test system prompt',
    );

    // Mock the turn execution to return tool call events
    const mockTurn = {
      run: vi.fn().mockReturnValue((async function* () {
        yield {
          type: GeminiEventType.ToolCallRequest,
          value: {
            callId: 'test-call-1',
            name: 'return_from_task',
            args: { success: true, description: 'Task completed', result: 'Test result' },
            isClientInitiated: false,
          },
        };
      })()),
      pendingToolCalls: [],
    };

    // Mock tool execution
    const returnTool = new ReturnFromTaskTool();
    mockToolRegistry.getTool.mockImplementation((name: string) => {
      if (name === 'return_from_task') return returnTool;
      return null;
    });

    // Spy on the private method using prototype
    const checkForAgentReturnSpy = vi.spyOn(TaskAgentRunner.prototype as any, 'checkForAgentReturn');

    // Override Turn constructor for this test
    const Turn = await import('./turn.js');
    vi.spyOn(Turn, 'Turn').mockImplementation(() => mockTurn as any);

    const result = await runner.run('test task', 'test prompt', 5, 60000);

    expect(result).toEqual({
      success: true,
      description: 'Task completed',
      result: 'Test result',
    });

    // Verify checkForAgentReturn was called with the correct format
    expect(checkForAgentReturnSpy).toHaveBeenCalledWith([{ 
      text: JSON.stringify({
        type: 'agent_return',
        success: true,
        description: 'Task completed',
        result: 'Test result',
      })
    }]);
  });

  it('should handle timeout gracefully and request summary', async () => {
    const runner = new TaskAgentRunner(
      config,
      contentGenerator,
      [],
      'test system prompt',
    );

    // Mock turn that never returns agent_return
    const mockTurn = {
      run: vi.fn().mockImplementation(async function* () {
        yield {
          type: GeminiEventType.Content,
          value: 'Working on task...',
        };
      }),
      pendingToolCalls: [],
    };

    const Turn = await import('./turn.js');
    vi.spyOn(Turn, 'Turn').mockImplementation(() => mockTurn as any);

    // Use a very short timeout to trigger the timeout path
    const resultPromise = runner.run('test task', 'test prompt', 5, 100);

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150));

    const result = await resultPromise;

    expect(result).toEqual({
      success: false,
      description: 'Agent failed to complete task within time limit and did not provide a summary.',
      result: '',
    });
  });

  it('should correctly process tool call events from async stream', async () => {
    const runner = new TaskAgentRunner(
      config,
      contentGenerator,
      [],
      'test system prompt',
    );

    let capturedToolCalls: any[] = [];

    // Mock turn with multiple events
    const mockTurn = {
      run: vi.fn().mockReturnValue((async function* () {
        yield { type: GeminiEventType.Content, value: 'Thinking...' };
        yield {
          type: GeminiEventType.ToolCallRequest,
          value: {
            callId: 'call-1',
            name: 'some_tool',
            args: { param: 'value' },
            isClientInitiated: false,
          },
        };
        yield { type: GeminiEventType.Content, value: 'Done thinking.' };
      })()),
      pendingToolCalls: [],
    };

    // Capture what gets added to pendingToolCalls
    Object.defineProperty(mockTurn.pendingToolCalls, 'push', {
      value: vi.fn((...items: any[]) => {
        capturedToolCalls.push(...items);
      }),
    });

    const Turn = await import('./turn.js');
    vi.spyOn(Turn, 'Turn').mockImplementation(() => mockTurn as any);

    // Mock tool to prevent execution
    mockToolRegistry.getTool.mockReturnValue(null);

    try {
      await runner.run('test task', 'test prompt', 1, 60000);
    } catch {
      // Expected to fail since we're not providing return_from_task
    }

    // Verify tool calls were properly collected
    expect(capturedToolCalls).toHaveLength(1);
    expect(capturedToolCalls[0]).toEqual({
      callId: 'call-1',
      name: 'some_tool',
      args: { param: 'value' },
      isClientInitiated: false,
    });
  });
});