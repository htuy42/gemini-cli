/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, statSync } from 'fs';
import { Config } from '../../config/config.js';
import { BaseTool, ToolResult } from '../tools.js';
import { FlashIntegration } from './flash-integration.js';
import {
  FileReadOptions,
  FileReadResult,
  EditChange,
  FileEditResult,
  FileWriteResult,
  SmartEditRequest,
  SmartEditResult,
} from './types.js';
import { createDiff } from '../../utils/diff.js';
import { detectFileType } from '../../utils/fileUtils.js';

/**
 * Unified file operations tool
 */
export class FileTool extends BaseTool {
  static Name = 'file';
  private flash: FlashIntegration;
  
  static description = `Unified file operations tool for reading, editing, and writing files.

Operations:
1. read - Read file content with multiple modes
2. edit - Make line-based edits to files  
3. smartEdit - AI-assisted editing
4. write - Create or overwrite files

Example usage:
file("read", "/path/to/file.ts", { mode: "summary", prompt: "What functions are exported?" })
file("edit", "/path/to/file.ts", [{ line: 42, operation: "replace", content: "  return true;" }])
file("smartEdit", "/path/to/file.ts", { find: "authenticate function", change: "add error handling" })
file("write", "/path/to/new.ts", "content here")`;

  constructor(
    private rootPath: string, 
    private config: Config,
    flash?: FlashIntegration
  ) {
    super(
      FileTool.Name,
      FileTool.Name,
      FileTool.description,
      {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: 'Operation to perform: read, edit, smartEdit, or write',
            enum: ['read', 'edit', 'smartEdit', 'write'],
          },
          path: {
            type: 'string',
            description: 'Absolute path to the file',
          },
          options: {
            type: 'object',
            description: 'Options for read operation',
            properties: {
              mode: { type: 'string', enum: ['full', 'lines', 'summary'] },
              lines: {
                type: 'object',
                properties: {
                  start: { type: 'number' },
                  end: { type: 'number' },
                },
              },
              prompt: { type: 'string' },
              includeLineNumbers: { type: 'boolean' },
            },
          },
          changes: {
            type: 'array',
            description: 'Array of changes for edit operation',
            items: {
              type: 'object',
              properties: {
                line: { type: 'number' },
                operation: { type: 'string', enum: ['replace', 'insert', 'delete'] },
                content: { type: 'string' },
              },
              required: ['line', 'operation'],
            },
          },
          smartEditRequest: {
            type: 'object',
            description: 'Request for smart edit operation',
            properties: {
              find: { type: 'string' },
              task: { type: 'string' },
              change: { type: 'string' },
              verify: { type: 'boolean' },
            },
          },
          content: {
            type: 'string',
            description: 'Content for write operation',
          },
        },
        required: ['operation', 'path'],
      }
    );
    this.flash = flash || new FlashIntegration(config);
  }

  async execute(args: unknown, signal: AbortSignal): Promise<ToolResult> {
    const params = this.validateAndParseArgs(args);
    
    // Validate and resolve path
    const absolutePath = path.isAbsolute(params.path)
      ? params.path
      : path.resolve(this.rootPath, params.path);

    // Security check
    if (!absolutePath.startsWith(this.rootPath)) {
      const errorMsg = `Path must be within project root: ${this.rootPath}`;
      return {
        status: 'error',
        message: errorMsg,
        llmContent: errorMsg,
        returnDisplay: 'Path security error',
      } as FileReadResult;
    }

    switch (params.operation) {
      case 'read':
        return this.read(absolutePath, params.options || {}, signal);
      case 'edit':
        return this.edit(absolutePath, params.changes || [], signal);
      case 'smartEdit':
        return this.smartEdit(absolutePath, params.smartEditRequest || {}, signal);
      case 'write':
        return this.write(absolutePath, params.content || '', signal);
      default:
        return {
          status: 'error',
          message: `Unknown operation: ${params.operation}`,
          llmContent: `Error: Unknown operation: ${params.operation}`,
          returnDisplay: `❌ Unknown operation: ${params.operation}`,
        } as FileReadResult;
    }
  }

  protected validateAndParseArgs(args: unknown): any {
    if (!args || typeof args !== 'object') {
      throw new Error('Arguments must be an object');
    }
    
    const params = args as any;
    if (!params.operation || !params.path) {
      throw new Error('operation and path are required');
    }
    
    // Validate operation-specific parameters
    switch (params.operation) {
      case 'read':
        if (params.options) {
          if (params.options.mode === 'lines' && !params.options.lines) {
            throw new Error('lines option required when mode is "lines"');
          }
          if (params.options.mode === 'summary' && !params.options.prompt) {
            params.options.prompt = 'Provide a structural overview of this file';
          }
        }
        break;
      case 'edit':
        if (!params.changes || !Array.isArray(params.changes) || params.changes.length === 0) {
          throw new Error('changes array is required for edit operation');
        }
        break;
      case 'smartEdit':
        if (!params.smartEditRequest || typeof params.smartEditRequest !== 'object') {
          throw new Error('smartEditRequest object is required for smartEdit operation');
        }
        if (!params.smartEditRequest.find && !params.smartEditRequest.task) {
          throw new Error('smartEditRequest must have at least "find" or "task"');
        }
        break;
      case 'write':
        if (params.content === undefined) {
          params.content = ''; // Allow empty content
        }
        break;
    }
    
    return params;
  }

  /**
   * Read file with multiple modes
   */
  private async read(
    filePath: string,
    options: FileReadOptions,
    signal: AbortSignal
  ): Promise<FileReadResult> {
    try {
      // Check if file exists
      if (!existsSync(filePath)) {
        return {
          status: 'error',
          message: `File not found: ${filePath}`,
          llmContent: `Error: File not found: ${filePath}`,
          returnDisplay: `❌ File not found: ${filePath}`,
        };
      }

      // Check if it's a directory
      const stats = statSync(filePath);
      if (stats.isDirectory()) {
        return {
          status: 'error',
          message: `Path is a directory: ${filePath}`,
          llmContent: `Error: Path is a directory: ${filePath}`,
          returnDisplay: `❌ Path is a directory: ${filePath}`,
        };
      }

      // Check if it's a binary file
      const fileType = detectFileType(filePath);
      if (fileType === 'binary' || fileType === 'image' || fileType === 'pdf') {
        return {
          status: 'error',
          message: `Cannot read ${fileType} file: ${filePath}. This tool only supports text files.`,
          llmContent: `Error: Cannot read ${fileType} file: ${filePath}. This tool only supports text files.`,
          returnDisplay: `❌ Cannot read ${fileType} file: ${filePath}. This tool only supports text files.`,
        };
      }

      // Check file size (limit to 10MB for safety)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (stats.size > MAX_FILE_SIZE) {
        return {
          status: 'error',
          message: `File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE} bytes)`,
          llmContent: `Error: File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE} bytes)`,
          returnDisplay: `❌ File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE} bytes)`,
        };
      }

      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      const mode = options.mode || 'full';

      switch (mode) {
        case 'full':
          return this.readFull(filePath, content, lines, options);
          
        case 'lines':
          return this.readLines(filePath, content, lines, options);
          
        case 'summary':
          return this.readSummary(filePath, content, options, signal);
          
        default:
          return {
            status: 'error',
            message: `Unknown read mode: ${mode}`,
            llmContent: `Error: Unknown read mode: ${mode}`,
            returnDisplay: `❌ Unknown read mode: ${mode}`,
          };
      }
    } catch (error) {
      return {
        status: 'error',
        message: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        llmContent: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        returnDisplay: `❌ Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async readFull(
    filePath: string,
    content: string,
    lines: string[],
    options: FileReadOptions
  ): Promise<FileReadResult> {
    const includeLineNumbers = options.includeLineNumbers ?? true;
    const displayContent = includeLineNumbers
      ? lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
      : content;

    return {
      status: 'success',
      llmContent: displayContent,
      returnDisplay: `Read ${filePath} (${lines.length} lines)`,
      metadata: {
        totalLines: lines.length,
        fileSize: content.length,
      },
    };
  }

  private async readLines(
    filePath: string,
    content: string,
    lines: string[],
    options: FileReadOptions
  ): Promise<FileReadResult> {
    if (!options.lines) {
      return {
        status: 'error',
        message: 'lines option required for lines mode',
        llmContent: 'Error: lines option required for lines mode',
        returnDisplay: '❌ lines option required for lines mode',
      };
    }

    const { start, end } = options.lines;
    if (start < 1 || end > lines.length || start > end) {
      return {
        status: 'error',
        message: `Invalid line range: ${start}-${end}. File has ${lines.length} lines.`,
        llmContent: `Error: Invalid line range: ${start}-${end}. File has ${lines.length} lines.`,
        returnDisplay: `❌ Invalid line range: ${start}-${end}. File has ${lines.length} lines.`,
      };
    }

    const includeLineNumbers = options.includeLineNumbers ?? true;
    const selectedLines = lines.slice(start - 1, end);
    const displayContent = includeLineNumbers
      ? selectedLines.map((line, i) => `${start + i}: ${line}`).join('\n')
      : selectedLines.join('\n');


    return {
      status: 'success',
      llmContent: displayContent,
      returnDisplay: `Read lines ${start}-${end} of ${filePath}`,
      message: `Lines ${start}-${end} of ${lines.length}`,
      metadata: {
        totalLines: lines.length,
      },
    };
  }

  private async readSummary(
    filePath: string,
    content: string,
    options: FileReadOptions,
    signal: AbortSignal
  ): Promise<FileReadResult> {
    const prompt = options.prompt || 'Provide a structural overview of this file';
    
    // Generate summary
    try {
      const summary = await this.flash.generateSummary(filePath, content, prompt);
      
      return {
        status: 'success',
        llmContent: summary,
        returnDisplay: `Summary of ${filePath}`,
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        llmContent: `Error: Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        returnDisplay: `❌ Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Line-based edit operation
   */
  private async edit(
    filePath: string,
    changes: EditChange[],
    signal: AbortSignal
  ): Promise<FileEditResult> {
    try {
      // Check if file exists
      if (!existsSync(filePath)) {
        return {
          status: 'error',
          message: `File not found: ${filePath}`,
          llmContent: `Error: File not found: ${filePath}`,
          returnDisplay: `❌ File not found: ${filePath}`,
        };
      }

      // Read current content
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const originalLines = [...lines];
      
      // Sort changes by line number (descending) to avoid offset issues
      const sortedChanges = [...changes].sort((a, b) => b.line - a.line);
      
      // Apply changes
      for (const change of sortedChanges) {
        const lineIndex = change.line - 1;
        
        switch (change.operation) {
          case 'replace':
            if (lineIndex < 0 || lineIndex >= lines.length) {
              return {
                status: 'error',
                message: `Line ${change.line} out of range (file has ${lines.length} lines)`,
                llmContent: `Error: Line ${change.line} out of range (file has ${lines.length} lines)`,
                returnDisplay: `❌ Line ${change.line} out of range (file has ${lines.length} lines)`,
              };
            }
            lines[lineIndex] = change.content || '';
            break;
            
          case 'insert':
            // Insert at lineIndex (so new line becomes line number change.line)
            lines.splice(lineIndex, 0, change.content || '');
            break;
            
          case 'delete':
            if (lineIndex < 0 || lineIndex >= lines.length) {
              return {
                status: 'error',
                message: `Line ${change.line} out of range (file has ${lines.length} lines)`,
                llmContent: `Error: Line ${change.line} out of range (file has ${lines.length} lines)`,
                returnDisplay: `❌ Line ${change.line} out of range (file has ${lines.length} lines)`,
              };
            }
            lines.splice(lineIndex, 1);
            break;
            
          default:
            return {
              status: 'error',
              message: `Unknown operation: ${change.operation}`,
              llmContent: `Error: Unknown operation: ${change.operation}`,
              returnDisplay: `❌ Unknown operation: ${change.operation}`,
            };
        }
      }
      
      // Write back
      const newContent = lines.join('\n');
      await fs.writeFile(filePath, newContent, 'utf-8');
      
      
      // Generate diff
      const diff = createDiff(
        originalLines.join('\n'),
        newContent,
        filePath,
        filePath
      );
      
      return {
        status: 'success',
        message: `Applied ${changes.length} changes`,
        diff,
        llmContent: diff,
        returnDisplay: `Edited ${filePath} (${changes.length} changes)`,
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Error editing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        llmContent: `Error editing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        returnDisplay: `❌ Error editing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * AI-assisted edit operation
   */
  private async smartEdit(
    filePath: string,
    request: SmartEditRequest,
    signal: AbortSignal
  ): Promise<SmartEditResult> {
    try {
      // Check if file exists
      if (!existsSync(filePath)) {
        return {
          status: 'error',
          message: `File not found: ${filePath}`,
          llmContent: `Error: File not found: ${filePath}`,
          returnDisplay: `❌ File not found: ${filePath}`,
        };
      }

      // Read current content
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Find edit location using Flash
      const flashResponse = await this.flash.findEditLocation(filePath, content, request);
      
      if (flashResponse.status === 'not_found') {
        return {
          status: 'error',
          message: flashResponse.message || `Could not find: ${request.find}`,
          suggestion: 'Try being more specific or check the file content',
          confidence: flashResponse.confidence,
          llmContent: flashResponse.message || `Error: Could not find: ${request.find}`,
          returnDisplay: `❌ ${flashResponse.message || `Could not find: ${request.find}`}`,
        };
      }
      
      if (flashResponse.status === 'unsure' || flashResponse.confidence < 0.7) {
        return {
          status: 'needs_confirmation',
          message: flashResponse.message || 'Flash is unsure about this edit',
          suggestedEdits: flashResponse.edits,
          confidence: flashResponse.confidence,
          suggestion: 'Review suggested edits and use direct edit() if correct',
          llmContent: flashResponse.message || 'Flash is unsure about this edit. Review suggested edits and use direct edit() if correct.',
          returnDisplay: `⚠️ ${flashResponse.message || 'Flash is unsure about this edit'}`,
        };
      }
      
      if (!flashResponse.edits || flashResponse.edits.length === 0) {
        return {
          status: 'error',
          message: 'No edits suggested',
          confidence: flashResponse.confidence,
          llmContent: 'Error: No edits suggested',
          returnDisplay: '❌ No edits suggested',
        };
      }
      
      // Apply the edits
      const editResult = await this.edit(filePath, flashResponse.edits, signal);
      
      // If edit failed, return the error
      if (editResult.status === 'error') {
        return {
          ...editResult,
          confidence: flashResponse.confidence,
        };
      }
      
      // Verify if requested
      if (request.verify && editResult.status === 'success') {
        const newContent = await fs.readFile(filePath, 'utf-8');
        const verifyResponse = await this.flash.verifyEdit(
          content,
          newContent,
          request.task || request.change || 'Edit file'
        );
        
        if (verifyResponse.hasIssues) {
          return {
            status: 'completed_with_warnings',
            diff: editResult.diff,
            warnings: verifyResponse.issues,
            suggestion: verifyResponse.suggestion,
            confidence: flashResponse.confidence,
            llmContent: editResult.diff || 'Smart edit completed with warnings',
            returnDisplay: `Smart edited ${filePath} with warnings`,
          };
        }
      }
      
      return {
        ...editResult,
        confidence: flashResponse.confidence,
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Error in smart edit: ${error instanceof Error ? error.message : 'Unknown error'}`,
        confidence: 0,
        llmContent: `Error in smart edit: ${error instanceof Error ? error.message : 'Unknown error'}`,
        returnDisplay: `❌ Error in smart edit: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Write operation
   */
  private async write(
    filePath: string,
    content: string,
    signal: AbortSignal
  ): Promise<FileWriteResult> {
    try {
      // Check if file exists
      const exists = existsSync(filePath);
      
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Write file
      await fs.writeFile(filePath, content, 'utf-8');
      
      
      return {
        status: 'success',
        message: exists ? 'File overwritten' : 'File created',
        llmContent: `${exists ? 'Overwrote' : 'Created'} ${filePath}`,
        returnDisplay: `${exists ? 'Overwrote' : 'Created'} ${filePath}`,
        metadata: {
          fileSize: content.length,
          created: !exists,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        llmContent: `Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        returnDisplay: `❌ Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}