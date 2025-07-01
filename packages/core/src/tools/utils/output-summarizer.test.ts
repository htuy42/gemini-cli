/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutputSummarizer, DEFAULT_MAX_CHARACTERS } from './output-summarizer.js';
import { type Config } from '../../config/config.js';

describe('OutputSummarizer', () => {
  let mockConfig: Config;
  let outputSummarizer: OutputSummarizer;

  beforeEach(() => {
    // Create a mock config
    mockConfig = {
      getGeminiClient: vi.fn().mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{
            content: {
              parts: [{ text: 'This is a summary of the output' }]
            }
          }]
        })
      })
    } as unknown as Config;

    outputSummarizer = new OutputSummarizer(mockConfig);
  });

  describe('summarizeIfNeeded', () => {
    it('should not summarize when content is below threshold', async () => {
      const content = 'Short content';
      const result = await outputSummarizer.summarizeIfNeeded(content, 'Test', {
        maxAllowedCharacters: 100
      });

      expect(result.isSummarized).toBe(false);
      expect(result.content).toBe(content);
      expect(result.originalLength).toBe(content.length);
      expect(mockConfig.getGeminiClient).not.toHaveBeenCalled();
    });

    it('should summarize when content exceeds threshold', async () => {
      const longContent = 'x'.repeat(1000);
      const result = await outputSummarizer.summarizeIfNeeded(longContent, 'Test', {
        maxAllowedCharacters: 100
      });

      expect(result.isSummarized).toBe(true);
      expect(result.content).toBe('This is a summary of the output');
      expect(result.originalLength).toBe(1000);
      expect(result.summarizedLength).toBe(31);
      expect(mockConfig.getGeminiClient).toHaveBeenCalled();
    });

    it('should use default maxAllowedCharacters when not specified', async () => {
      const content = 'x'.repeat(DEFAULT_MAX_CHARACTERS + 1000); // More than default
      const result = await outputSummarizer.summarizeIfNeeded(content, 'Test');

      expect(result.isSummarized).toBe(true);
      expect(result.content).toBe('This is a summary of the output');
    });

    it('should not summarize when content is just below default threshold', async () => {
      const content = 'x'.repeat(DEFAULT_MAX_CHARACTERS - 100); // Just below default
      const result = await outputSummarizer.summarizeIfNeeded(content, 'Test');

      expect(result.isSummarized).toBe(false);
      expect(result.content).toBe(content);
      expect(result.originalLength).toBe(DEFAULT_MAX_CHARACTERS - 100);
    });

    it('should strip ANSI codes before checking length', async () => {
      const contentWithAnsi = '\x1b[31mRed text\x1b[0m';
      const result = await outputSummarizer.summarizeIfNeeded(contentWithAnsi, 'Test', {
        maxAllowedCharacters: 100
      });

      expect(result.isSummarized).toBe(false);
      expect(result.content).toBe('Red text'); // ANSI codes stripped
      expect(result.originalLength).toBe(8); // Length without ANSI codes
    });

    it('should use custom prompt when provided', async () => {
      const longContent = 'x'.repeat(1000);
      const customPrompt = 'Custom summarization prompt';
      
      await outputSummarizer.summarizeIfNeeded(longContent, 'Test', {
        maxAllowedCharacters: 100,
        prompt: customPrompt
      });

      const client = mockConfig.getGeminiClient();
      expect(client.generateContent).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            parts: [
              expect.objectContaining({ 
                text: expect.stringContaining(customPrompt)
              })
            ]
          })
        ]),
        expect.any(Object),
        expect.any(AbortSignal)
      );
    });

    it('should provide fallback summary when Flash fails', async () => {
      // Make generateContent throw an error
      const failingConfig = {
        getGeminiClient: vi.fn().mockReturnValue({
          generateContent: vi.fn().mockRejectedValue(new Error('API error'))
        })
      } as unknown as Config;

      const summarizer = new OutputSummarizer(failingConfig);
      const longContent = 'Line 1\n'.repeat(100);
      
      const result = await summarizer.summarizeIfNeeded(longContent, 'Test', {
        maxAllowedCharacters: 100
      });

      expect(result.isSummarized).toBe(true);
      expect(result.content).toContain('Test output too large to display fully');
      expect(result.content).toContain('700 characters, 101 lines');
      expect(result.content).toContain('First 20 lines:');
    });

    // Skipping timeout test as it depends on the actual client implementation
    // and how it handles abort signals

    it('should use tool-specific prompts', async () => {
      const longContent = 'x'.repeat(1000);
      
      // Test Shell tool prompt
      await outputSummarizer.summarizeIfNeeded(longContent, 'Shell', {
        maxAllowedCharacters: 100
      });

      let client = mockConfig.getGeminiClient();
      expect(client.generateContent).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            parts: [
              expect.objectContaining({ 
                text: expect.stringContaining('shell command execution')
              })
            ]
          })
        ]),
        expect.any(Object),
        expect.any(AbortSignal)
      );

      // Reset and test Grep tool prompt
      vi.clearAllMocks();
      
      await outputSummarizer.summarizeIfNeeded(longContent, 'Grep', {
        maxAllowedCharacters: 100
      });

      client = mockConfig.getGeminiClient();
      expect(client.generateContent).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            parts: [
              expect.objectContaining({ 
                text: expect.stringContaining('search results')
              })
            ]
          })
        ]),
        expect.any(Object),
        expect.any(AbortSignal)
      );
    });
  });
});