/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../../config/config.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../../config/models.js';
import { FlashEditResponse, FlashVerifyResponse, SmartEditRequest, EditChange } from './types.js';
import { getResponseText } from '../../utils/generateContentResponseUtilities.js';

/**
 * System prompt for Flash when summarizing files
 */
const FLASH_FILE_SUMMARY_PROMPT = `You are a file analysis assistant. Your job is to provide concise, targeted summaries of file contents based on specific queries.

Guidelines:
- Be extremely concise - aim for the minimum text that fully answers the query
- Use structured output (lists, bullet points) when appropriate
- Include line numbers for important items when helpful
- Focus only on what the query asks for
- For code files: include signatures but not implementation details
- For documentation: include headings and key points
- If the query is vague, provide a structural overview

Never include:
- Explanations of what you're doing
- Apologies or hedging
- Implementation details unless specifically asked
- Comments about the code quality`;

/**
 * System prompt for Flash when finding edit locations
 */
const FLASH_EDIT_FINDER_PROMPT = `You are a code editing assistant. Your job is to find specific locations in code files and suggest line-based edits.

Guidelines:
- Return valid JSON only
- Be conservative - if unsure, return status "unsure" or "not_found"
- Include specific line numbers
- For replacements, provide the complete new line content
- Maintain proper indentation

Never:
- Make assumptions about code intent
- Suggest risky changes without high confidence
- Return multiple possible locations unless very confident`;

/**
 * System prompt for Flash when verifying edits
 */
const FLASH_EDIT_VERIFY_PROMPT = `You are a code review assistant. Review code changes for correctness and potential issues.

Focus on:
- Syntax errors
- Logic errors  
- Missing imports or dependencies
- Inconsistent style
- Security issues
- Performance problems

Be concise and specific about any issues found.`;

/**
 * Flash integration for file operations
 */
export class FlashIntegration {
  constructor(private config: Config) {}

  /**
   * Generate a file summary using Flash
   */
  async generateSummary(
    filePath: string,
    content: string,
    userPrompt?: string
  ): Promise<string> {
    const prompt = `File: ${filePath}

User Query: ${userPrompt || 'Provide a structural overview of this file'}

File Content:
${content}`;

    try {
      const client = this.config.getGeminiClient();
      if (!client) {
        throw new Error('Gemini client not initialized');
      }
      const response = await client.generateContent(
        [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        {
          systemInstruction: FLASH_FILE_SUMMARY_PROMPT,
          temperature: 0,
          maxOutputTokens: 500,
        },
        AbortSignal.timeout(30000)
      );

      const text = getResponseText(response);
      if (!text) {
        throw new Error('Flash returned empty summary');
      }

      return text.trim();
    } catch (error) {
      console.error('Flash summary generation failed:', error);
      // Fallback to a basic summary
      const lines = content.split('\n');
      return `File contains ${lines.length} lines. Unable to generate detailed summary: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Find edit location using Flash
   */
  async findEditLocation(
    filePath: string,
    content: string,
    request: SmartEditRequest
  ): Promise<FlashEditResponse> {
    const prompt = this.buildEditFinderPrompt(filePath, content, request);

    try {
      const client = this.config.getGeminiClient();
      if (!client) {
        throw new Error('Gemini client not initialized');
      }
      const response = await client.generateJson(
        [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['success', 'unsure', 'not_found'],
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  line: { type: 'number' },
                  operation: {
                    type: 'string',
                    enum: ['replace', 'insert', 'delete'],
                  },
                  content: { type: 'string' },
                },
                required: ['line', 'operation'],
              },
            },
            message: { type: 'string' },
          },
          required: ['status', 'confidence'],
        },
        AbortSignal.timeout(30000),
        DEFAULT_GEMINI_FLASH_MODEL,
        {
          systemInstruction: FLASH_EDIT_FINDER_PROMPT,
          temperature: 0,
        }
      );

      return response as unknown as FlashEditResponse;
    } catch (error) {
      console.error('Flash edit finder failed:', error);
      return {
        status: 'not_found',
        confidence: 0,
        message: `Failed to analyze file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Verify an edit using Flash
   */
  async verifyEdit(
    originalContent: string,
    newContent: string,
    intent: string
  ): Promise<FlashVerifyResponse> {
    const prompt = `Review this code edit for correctness.

Intent: ${intent}

Original content:
${originalContent}

Modified content:
${newContent}

Return JSON with:
- hasIssues: boolean
- issues: array of specific problems found (if any)
- suggestion: how to fix the issues (if any)`;

    try {
      const client = this.config.getGeminiClient();
      if (!client) {
        throw new Error('Gemini client not initialized');
      }
      const response = await client.generateJson(
        [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        {
          type: 'object',
          properties: {
            hasIssues: { type: 'boolean' },
            issues: {
              type: 'array',
              items: { type: 'string' },
            },
            suggestion: { type: 'string' },
          },
          required: ['hasIssues'],
        },
        AbortSignal.timeout(30000),
        DEFAULT_GEMINI_FLASH_MODEL,
        {
          systemInstruction: FLASH_EDIT_VERIFY_PROMPT,
          temperature: 0,
        }
      );

      return response as unknown as FlashVerifyResponse;
    } catch (error) {
      console.error('Flash edit verification failed:', error);
      // On failure, don't block the edit
      return {
        hasIssues: false,
      };
    }
  }

  /**
   * Build prompt for edit finder
   */
  private buildEditFinderPrompt(
    filePath: string,
    content: string,
    request: SmartEditRequest
  ): string {
    const lines = content.split('\n');
    const numberedContent = lines
      .map((line, index) => `${index + 1}: ${line}`)
      .join('\n');

    let taskDescription = '';
    if (request.find) {
      taskDescription += `Find: "${request.find}"\n`;
    }
    if (request.task) {
      taskDescription += `Task: "${request.task}"\n`;
    }
    if (request.change) {
      taskDescription += `Change to make: "${request.change}"\n`;
    }

    return `File: ${filePath}

${taskDescription}

Numbered content:
${numberedContent}

Return JSON with:
- status: "success" if you found the location, "not_found" if it doesn't exist, "unsure" if you're not confident
- confidence: 0-1 indicating how sure you are
- edits: array of line-based edits to make
- message: explanation if not found or unsure`;
  }
}