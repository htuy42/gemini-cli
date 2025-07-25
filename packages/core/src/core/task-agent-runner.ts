/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Part, PartListUnion } from '@google/genai';
import { Config } from '../config/config.js';
import { GeminiChat } from './geminiChat.js';
import { ContentGenerator } from './contentGenerator.js';
import { Turn, ServerGeminiStreamEvent, GeminiEventType, ToolCallRequestInfo } from './turn.js';
import { TaskAgentResult } from '../tools/task-agent-tool.js';
import { ReturnFromTaskTool } from '../tools/return-from-task-tool.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { getCoreSystemPrompt } from './prompts.js';
import { convertToFunctionResponse } from './coreToolScheduler.js';

export class TaskAgentRunner {
  private agentRegistry?: ToolRegistry;
  
  constructor(
    private config: Config,
    private contentGenerator: ContentGenerator,
    private parentHistory: Content[],
    private agentSystemPrompt: string,
  ) {}
  
  async run(
    task: string,
    prompt: string,
    maxTurns: number,
    timeoutMs: number,
  ): Promise<TaskAgentResult> {
    // Create agent-specific tool registry
    this.agentRegistry = await this.createAgentToolRegistry();
    
    // Create a new chat with forked history and custom system prompt
    const agentChat = new GeminiChat(
      this.config,
      this.contentGenerator,
      {
        systemInstruction: this.agentSystemPrompt,
      },
      [...this.parentHistory], // Copy the history
    );
    
    // Set up timeout handling
    const timeoutPromise = new Promise<TaskAgentResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Agent timeout'));
      }, timeoutMs);
    });
    
    // Set up warning timeout (30 seconds before hard timeout)
    const warningTimeoutMs = Math.max(0, timeoutMs - 30000);
    let warningFired = false;
    const warningTimeout = setTimeout(() => {
      warningFired = true;
    }, warningTimeoutMs);
    
    try {
      // Run the agent
      const result = await Promise.race([
        this.runAgentTurns(agentChat, task, maxTurns, () => warningFired),
        timeoutPromise,
      ]);
      
      clearTimeout(warningTimeout);
      return result;
    } catch (error) {
      clearTimeout(warningTimeout);
      
      if (error instanceof Error && error.message === 'Agent timeout') {
        // Ask agent to summarize before hard cutoff
        return await this.requestAgentSummary(agentChat, task);
      }
      
      throw error;
    }
  }
  
  private async runAgentTurns(
    chat: GeminiChat,
    task: string,
    maxTurns: number,
    isTimeWarning: () => boolean,
  ): Promise<TaskAgentResult> {
    let turnsRemaining = maxTurns;
    let lastMessage: PartListUnion = [{ text: `Begin working on your task: ${task}` }];
    
    while (turnsRemaining > 0) {
      // Check if we should warn about time
      if (isTimeWarning() && turnsRemaining === maxTurns) {
        const warningText = Array.isArray(lastMessage) && lastMessage.length === 1 && typeof lastMessage[0] === 'object' && 'text' in lastMessage[0] 
          ? (lastMessage[0] as any).text + '\n\nWARNING: Your time is almost up (less than 30 seconds remaining). Please summarize your progress and return soon.'
          : 'WARNING: Your time is almost up (less than 30 seconds remaining). Please summarize your progress and return soon.';
        lastMessage = [{ text: warningText }];
      }
      
      // Send message and get response
      const turn = new Turn(chat);
      const events = turn.run(
        lastMessage,
        new AbortController().signal,
      );
      
      // Collect all events from the turn
      let modelResponse = '';
      const toolCallRequests: ToolCallRequestInfo[] = [];
      
      for await (const event of events) {
        if (event.type === GeminiEventType.Content) {
          modelResponse += event.value;
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
        }
      }
      
      // Store pending tool calls for processing
      turn.pendingToolCalls.push(...toolCallRequests);
      
      // Process tool calls
      if (turn.pendingToolCalls.length > 0) {
        const toolResults = await this.processToolCalls(turn.pendingToolCalls);
        
        // Check if any tool returned the agent return marker
        for (const result of toolResults) {
          if (result.result?.llmContent) {
            const agentReturn = this.checkForAgentReturn(result.result.llmContent);
            if (agentReturn) {
              return agentReturn;
            }
          }
        }
        
        // Convert tool results to function response parts
        const responseParts: Part[] = [];
        for (const result of toolResults) {
          if (result.error) {
            const errorResponse = convertToFunctionResponse(
              result.toolCall.name,
              result.toolCall.callId,
              `Error: ${result.error}`,
            );
            const parts = Array.isArray(errorResponse) ? errorResponse : [errorResponse];
            responseParts.push(...parts.filter(p => typeof p === 'object'));
          } else if (result.result) {
            const response = convertToFunctionResponse(
              result.toolCall.name,
              result.toolCall.callId,
              result.result.llmContent,
            );
            const parts = Array.isArray(response) ? response : [response];
            responseParts.push(...parts.filter(p => typeof p === 'object'));
          }
        }
        
        // Continue conversation with tool responses
        lastMessage = responseParts;
      } else if (modelResponse.trim()) {
        // Continue with model's response
        lastMessage = [{ text: 'Please continue with your task or use the return_from_task tool when finished.' }];
      } else {
        // No tool calls or response, prepare generic next message
        lastMessage = [{ text: 'Continue with your task.' }];
      }
      
      turnsRemaining--;
    }
    
    // Max turns reached, ask for summary
    return await this.requestAgentSummary(chat, task);
  }
  
  private checkForAgentReturn(response: any): TaskAgentResult | null {
    // Check if the response contains a return_from_task tool call result
    try {
      // The response is a PartListUnion from the tool
      let textContent: string | undefined;
      
      if (Array.isArray(response)) {
        // It's a Part[]
        const firstPart = response[0];
        if (firstPart && typeof firstPart === 'object' && 'text' in firstPart) {
          textContent = firstPart.text;
        }
      } else if (typeof response === 'object' && response && 'text' in response) {
        // It's a single Part
        textContent = response.text;
      }
      
      if (textContent) {
        const parsed = JSON.parse(textContent);
        if (parsed.type === 'agent_return') {
          return {
            success: parsed.success,
            description: parsed.description,
            result: parsed.result,
          };
        }
      }
    } catch {
      // Not a return response or invalid JSON
    }
    return null;
  }
  
  private async requestAgentSummary(
    chat: GeminiChat,
    task: string,
  ): Promise<TaskAgentResult> {
    const summaryPrompt = `Your time is up. Please use the return_from_task tool immediately to summarize:
- What you accomplished for the task: "${task}"
- The current state of any work in progress
- Any findings or partial results
- What remains to be done

Use the return_from_task tool now.`;
    
    try {
      const turn = new Turn(chat);
      const events = turn.run(
        [{ text: summaryPrompt }],
        new AbortController().signal,
      );
      
      // Collect events
      const toolCallRequests: ToolCallRequestInfo[] = [];
      for await (const event of events) {
        if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
        }
      }
      
      // Store pending tool calls for processing
      turn.pendingToolCalls.push(...toolCallRequests);
      
      // Process tool calls if any
      if (turn.pendingToolCalls.length > 0) {
        const toolResults = await this.processToolCalls(turn.pendingToolCalls);
        
        // Check if return_from_task was called
        for (const result of toolResults) {
          if (result.result?.llmContent) {
            const agentReturn = this.checkForAgentReturn(result.result.llmContent);
            if (agentReturn) {
              return agentReturn;
            }
          }
        }
      }
    } catch (error) {
      // Fall through to default
    }
    
    // Default failure response if agent doesn't return properly
    return {
      success: false,
      description: 'Agent failed to complete task within time limit and did not provide a summary.',
      result: '',
    };
  }
  
  private async createAgentToolRegistry(): Promise<ToolRegistry> {
    // Create a new registry with all parent tools plus ReturnFromTaskTool
    const parentRegistry = await this.config.getToolRegistry();
    const agentRegistry = new ToolRegistry(this.config);
    
    // Copy all tools from parent except TaskAgentTool (no nested agents)
    for (const tool of parentRegistry.getAllTools()) {
      if (tool.name !== 'task_agent') {
        agentRegistry.registerTool(tool);
      }
    }
    
    // Add the return tool
    agentRegistry.registerTool(new ReturnFromTaskTool());
    
    return agentRegistry;
  }
  
  private async processToolCalls(toolCalls: ToolCallRequestInfo[]): Promise<any[]> {
    if (!this.agentRegistry) {
      throw new Error('Agent registry not initialized');
    }
    
    const results = [];
    for (const toolCall of toolCalls) {
      const tool = this.agentRegistry.getTool(toolCall.name);
      if (!tool) {
        results.push({
          error: `Tool ${toolCall.name} not found`,
          toolCall,
        });
        continue;
      }
      
      try {
        const result = await tool.execute(
          toolCall.args || {},
          new AbortController().signal,
        );
        results.push({
          result,
          toolCall,
        });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
          toolCall,
        });
      }
    }
    
    return results;
  }
  
  private formatToolResults(results: any[]): string {
    const messages = results.map(r => {
      if (r.error) {
        return `Tool ${r.toolCall.name} failed: ${r.error}`;
      }
      return `Tool ${r.toolCall.name} completed: ${r.result.returnDisplay || 'Success'}`;
    });
    
    return messages.join('\n') + '\n\nContinue with your task.';
  }
}