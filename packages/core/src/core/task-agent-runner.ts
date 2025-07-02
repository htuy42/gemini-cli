/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Part } from '@google/genai';
import { Config } from '../config/config.js';
import { GeminiChat } from './geminiChat.js';
import { ContentGenerator } from './contentGenerator.js';
import { Turn, ServerGeminiStreamEvent, GeminiEventType } from './turn.js';
import { TaskAgentResult } from '../tools/task-agent-tool.js';
import { ReturnFromTaskTool } from '../tools/return-from-task-tool.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { getCoreSystemPrompt } from './prompts.js';

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
    let lastMessage = `Begin working on your task: ${task}`;
    
    while (turnsRemaining > 0) {
      // Check if we should warn about time
      if (isTimeWarning() && turnsRemaining === maxTurns) {
        lastMessage += '\n\nWARNING: Your time is almost up (less than 30 seconds remaining). Please summarize your progress and return soon.';
      }
      
      // Send message and get response
      const turn = new Turn(chat);
      const response = await turn.run(
        [{ text: lastMessage }],
        new AbortController().signal,
      );
      
      // Check if agent returned
      const agentReturn = this.checkForAgentReturn(response);
      if (agentReturn) {
        return agentReturn;
      }
      
      // Process tool calls
      if (turn.pendingToolCalls.length > 0) {
        const toolResults = await this.processToolCalls(turn.pendingToolCalls);
        lastMessage = this.formatToolResults(toolResults);
      } else {
        // No tool calls, prepare next message
        lastMessage = 'Continue with your task.';
      }
      
      turnsRemaining--;
    }
    
    // Max turns reached, ask for summary
    return await this.requestAgentSummary(chat, task);
  }
  
  private checkForAgentReturn(response: any): TaskAgentResult | null {
    // Check if the response contains a return_from_task tool call result
    try {
      // Look through the response for our special return marker
      if (typeof response === 'string' && response.includes('"type":"agent_return"')) {
        const parsed = JSON.parse(response);
        if (parsed.type === 'agent_return') {
          return {
            success: parsed.success,
            description: parsed.description,
            result: parsed.result,
          };
        }
      }
    } catch {
      // Not a return response
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
      const response = await turn.run(
        [{ text: summaryPrompt }],
        new AbortController().signal,
      );
      
      const agentReturn = this.checkForAgentReturn(response);
      if (agentReturn) {
        return agentReturn;
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
  
  private async processToolCalls(toolCalls: any[]): Promise<any[]> {
    // This would integrate with the actual tool execution system
    // For now, placeholder
    return [];
  }
  
  private formatToolResults(results: any[]): string {
    // Format tool results for the next message
    return 'Tool results received. Continue with your task.';
  }
}