/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';

/**
 * Task structure for the task tracking tool
 */
interface Task {
  id: string;          // "task-1", "task-2", etc.
  description: string; 
  createdAt: number;   // For ordering completed tasks
}

/**
 * Task list structure maintaining pending and completed tasks
 */
interface TaskList {
  pending: Task[];     // Ordered list - first item is "active"
  completed: Task[];   // Last 5 completed tasks only
}

/**
 * Parameters for the Task tool
 */
export interface TaskToolParams {
  /**
   * The operation to perform
   */
  operation: 'add' | 'list' | 'complete' | 'update';
  
  /**
   * Task description for add/update operations
   */
  description?: string;
  
  /**
   * Task ID for complete (optional) and update (required) operations
   */
  id?: string;
  
  /**
   * Position to insert task at (0-based, for add operation only)
   */
  position?: number;
}

/**
 * Maximum number of completed tasks to keep in history
 */
const MAX_COMPLETED_TASKS = 5;

/**
 * Task tracking tool for session-scoped task management
 */
export class TaskTool extends BaseTool<TaskToolParams, ToolResult> {
  static readonly Name = 'task_tracker';
  
  private taskList: TaskList = {
    pending: [],
    completed: []
  };
  
  private taskCounter = 0;

  constructor() {
    super(
      TaskTool.Name,
      'TaskTracker',
      `Manages a task list for tracking work during the session. Tasks are ordered, with the first pending task being the "active" one. Supports adding tasks, marking them complete, and updating descriptions.`,
      {
        properties: {
          operation: {
            description: 'The operation to perform',
            enum: ['add', 'list', 'complete', 'update'],
            type: 'string',
          },
          description: {
            description: 'Task description (required for add/update operations)',
            type: 'string',
          },
          id: {
            description: 'Task ID (optional for complete, required for update)',
            type: 'string',
            pattern: '^task-\\d+$',
          },
          position: {
            description: 'Position to insert task at (0-based, optional for add)',
            type: 'number',
            minimum: 0,
          },
        },
        required: ['operation'],
        type: 'object',
      },
    );
  }

  validateToolParams(params: TaskToolParams): string | null {
    if (
      this.schema.parameters &&
      !SchemaValidator.validate(
        this.schema.parameters as Record<string, unknown>,
        params,
      )
    ) {
      return 'Parameters failed schema validation.';
    }

    // Operation-specific validation
    switch (params.operation) {
      case 'add':
        if (!params.description || params.description.trim() === '') {
          return 'Description is required for add operation';
        }
        if (params.position !== undefined && params.position > this.taskList.pending.length) {
          return `Position ${params.position} is out of range (max: ${this.taskList.pending.length})`;
        }
        break;
        
      case 'update':
        if (!params.id) {
          return 'ID is required for update operation';
        }
        if (!params.description || params.description.trim() === '') {
          return 'Description is required for update operation';
        }
        if (!this.taskList.pending.find(t => t.id === params.id)) {
          return `Task ${params.id} not found in pending tasks`;
        }
        break;
        
      case 'complete':
        if (params.id && !this.taskList.pending.find(t => t.id === params.id)) {
          return `Task ${params.id} not found in pending tasks`;
        }
        if (!params.id && this.taskList.pending.length === 0) {
          return 'No pending tasks to complete';
        }
        break;
    }

    return null;
  }

  getDescription(params: TaskToolParams): string {
    switch (params.operation) {
      case 'add':
        return `Add task: ${params.description}`;
      case 'list':
        return 'List all tasks';
      case 'complete':
        return params.id ? `Complete task ${params.id}` : 'Complete current task';
      case 'update':
        return `Update task ${params.id}`;
      default:
        return 'Unknown operation';
    }
  }

  async execute(params: TaskToolParams): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
      };
    }

    switch (params.operation) {
      case 'add':
        return this.addTask(params.description!, params.position);
      case 'list':
        return this.listTasks();
      case 'complete':
        return this.completeTask(params.id);
      case 'update':
        return this.updateTask(params.id!, params.description!);
      default:
        return {
          llmContent: 'Error: Unknown operation',
          returnDisplay: 'Error: Unknown operation',
        };
    }
  }

  private addTask(description: string, position?: number): ToolResult {
    const newTask: Task = {
      id: `task-${++this.taskCounter}`,
      description: description.trim(),
      createdAt: Date.now(),
    };

    if (position === undefined) {
      // Add to end
      this.taskList.pending.push(newTask);
    } else {
      // Insert at position
      this.taskList.pending.splice(position, 0, newTask);
    }

    const display = this.formatTaskList();
    return {
      llmContent: `Added task ${newTask.id}: "${newTask.description}"${position !== undefined ? ` at position ${position}` : ''}\n\n${display}`,
      returnDisplay: display,
    };
  }

  private listTasks(): ToolResult {
    const display = this.formatTaskList();
    return {
      llmContent: display,
      returnDisplay: display,
    };
  }

  private completeTask(id?: string): ToolResult {
    let taskToComplete: Task | undefined;
    let taskIndex: number;

    if (id) {
      // Complete specific task
      taskIndex = this.taskList.pending.findIndex(t => t.id === id);
      if (taskIndex === -1) {
        return {
          llmContent: `Error: Task ${id} not found`,
          returnDisplay: `Error: Task ${id} not found`,
        };
      }
      taskToComplete = this.taskList.pending[taskIndex];
    } else {
      // Complete current/active task (first in pending)
      if (this.taskList.pending.length === 0) {
        return {
          llmContent: 'Error: No pending tasks to complete',
          returnDisplay: 'Error: No pending tasks to complete',
        };
      }
      taskIndex = 0;
      taskToComplete = this.taskList.pending[0];
    }

    // Remove from pending
    this.taskList.pending.splice(taskIndex, 1);

    // Add to completed (with timestamp)
    taskToComplete.createdAt = Date.now();
    this.taskList.completed.unshift(taskToComplete);

    // Maintain max completed tasks
    if (this.taskList.completed.length > MAX_COMPLETED_TASKS) {
      this.taskList.completed = this.taskList.completed.slice(0, MAX_COMPLETED_TASKS);
    }

    const display = this.formatTaskList();
    return {
      llmContent: `Completed task ${taskToComplete.id}: "${taskToComplete.description}"\n\n${display}`,
      returnDisplay: display,
    };
  }

  private updateTask(id: string, description: string): ToolResult {
    const task = this.taskList.pending.find(t => t.id === id);
    if (!task) {
      return {
        llmContent: `Error: Task ${id} not found`,
        returnDisplay: `Error: Task ${id} not found`,
      };
    }

    const oldDescription = task.description;
    task.description = description.trim();

    const display = this.formatTaskList();
    return {
      llmContent: `Updated task ${id} from "${oldDescription}" to "${task.description}"\n\n${display}`,
      returnDisplay: display,
    };
  }

  private formatTaskList(): string {
    const lines: string[] = ['=== Task List ==='];

    // Current/Active task
    if (this.taskList.pending.length > 0) {
      lines.push(`Current: [${this.taskList.pending[0].id}] ${this.taskList.pending[0].description}`);
      lines.push('');
    } else {
      lines.push('Current: No active task');
      lines.push('');
    }

    // Pending tasks (excluding the active one)
    if (this.taskList.pending.length > 1) {
      lines.push('Pending:');
      for (let i = 1; i < this.taskList.pending.length; i++) {
        const task = this.taskList.pending[i];
        lines.push(`  [${task.id}] ${task.description}`);
      }
      lines.push('');
    } else if (this.taskList.pending.length === 0) {
      lines.push('No pending tasks');
      lines.push('');
    }

    // Completed tasks
    if (this.taskList.completed.length > 0) {
      lines.push('Completed (recent):');
      for (const task of this.taskList.completed) {
        lines.push(`  ✓ [${task.id}] ${task.description}`);
      }
    }

    return lines.join('\n');
  }
}