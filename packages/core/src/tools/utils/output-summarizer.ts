/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config } from '../../config/config.js';
import { type Content } from '@google/genai';
import stripAnsi from 'strip-ansi';
import { getResponseText } from '../../utils/generateContentResponseUtilities.js';

export interface SummarizerOptions {
  maxAllowedCharacters?: number;
  prompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface SummarizationResult {
  isSummarized: boolean;
  content: string;
  originalLength: number;
  summarizedLength?: number;
}

export const DEFAULT_MAX_CHARACTERS = 10000;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_MAX_OUTPUT_TOKENS = 500;
const DEFAULT_TIMEOUT_MS = 30000;

export class OutputSummarizer {
  constructor(private config: Config) {}

  async summarizeIfNeeded(
    content: string,
    toolName: string,
    options: SummarizerOptions = {}
  ): Promise<SummarizationResult> {
    const {
      maxAllowedCharacters = DEFAULT_MAX_CHARACTERS,
      prompt,
      temperature = DEFAULT_TEMPERATURE,
      maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    const cleanContent = stripAnsi(content);
    const originalLength = cleanContent.length;

    if (originalLength <= maxAllowedCharacters) {
      return {
        isSummarized: false,
        content: cleanContent,
        originalLength,
      };
    }

    try {
      const summaryPrompt = prompt || this.getDefaultPrompt(toolName);
      const systemInstruction = this.getSystemInstruction(toolName);

      const result = await this.generateSummaryWithTimeout(
        cleanContent,
        summaryPrompt,
        systemInstruction,
        temperature,
        maxOutputTokens,
        timeoutMs
      );

      return {
        isSummarized: true,
        content: result,
        originalLength,
        summarizedLength: result.length,
      };
    } catch (error) {
      console.error('Summarization failed:', error);
      return this.createFallbackSummary(cleanContent, toolName, originalLength);
    }
  }

  private async generateSummaryWithTimeout(
    content: string,
    prompt: string,
    systemInstruction: string,
    temperature: number,
    maxOutputTokens: number,
    timeoutMs: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const contents: Content[] = [
        {
          parts: [
            { text: `${prompt}\n\n${content}` },
          ],
          role: 'user',
        },
      ];

      const client = this.config.getGeminiClient();
      if (!client) {
        throw new Error('Gemini client not initialized');
      }
      
      // Use generateJson method which defaults to Flash model
      const result = await client.generateContent(
        contents,
        {
          systemInstruction,
          temperature,
          maxOutputTokens,
        },
        controller.signal
      );

      const text = getResponseText(result);
      if (!text) {
        throw new Error('No summary generated');
      }

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getDefaultPrompt(toolName: string): string {
    const prompts: Record<string, string> = {
      Shell: 'Summarize the key output from this shell command execution. Focus on important results, errors, or status messages.',
      Grep: 'Summarize the search results, highlighting the most relevant matches and their patterns.',
      default: 'Summarize this output, focusing on the most important information.',
    };

    return prompts[toolName] || prompts.default;
  }

  private getSystemInstruction(toolName: string): string {
    return `You are an AI assistant that creates concise summaries of tool outputs.
When summarizing ${toolName} output:
- Extract the most important information
- Preserve critical error messages or warnings
- Mention the output size if relevant
- Keep the summary under 500 tokens
- Use a clear, structured format`;
  }

  private createFallbackSummary(
    content: string,
    toolName: string,
    originalLength: number
  ): SummarizationResult {
    const lines = content.split('\n');
    const lineCount = lines.length;
    const preview = lines.slice(0, 20).join('\n');
    const hasMore = lineCount > 20;

    const summary = `${toolName} output too large to display fully (${originalLength} characters, ${lineCount} lines).
First 20 lines:
${preview}${hasMore ? '\n... (truncated)' : ''}`;

    return {
      isSummarized: true,
      content: summary,
      originalLength,
      summarizedLength: summary.length,
    };
  }
}