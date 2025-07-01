/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskTool } from './task-tool.js';

describe('TaskTool', () => {
  let taskTool: TaskTool;

  beforeEach(() => {
    taskTool = new TaskTool();
  });

  describe('validation', () => {
    it('should validate add operation requires description', () => {
      const error = taskTool.validateToolParams({ operation: 'add' });
      expect(error).toBe('Description is required for add operation');
    });

    it('should validate update operation requires id and description', () => {
      let error = taskTool.validateToolParams({ operation: 'update' });
      expect(error).toBe('ID is required for update operation');

      error = taskTool.validateToolParams({ operation: 'update', id: 'task-1' });
      expect(error).toBe('Description is required for update operation');
    });

    it('should validate position is within range', async () => {
      // Add a task first
      await taskTool.execute({ operation: 'add', description: 'First task' });
      
      const error = taskTool.validateToolParams({ 
        operation: 'add', 
        description: 'Second task',
        position: 5 
      });
      expect(error).toBe('Position 5 is out of range (max: 1)');
    });

    it('should validate task ID format', () => {
      const error = taskTool.validateToolParams({ 
        operation: 'update', 
        id: 'invalid-id',
        description: 'Updated' 
      });
      expect(error).toBe('Task invalid-id not found in pending tasks');
    });
  });

  describe('add operation', () => {
    it('should add task to end of list', async () => {
      const result = await taskTool.execute({ 
        operation: 'add', 
        description: 'Implement authentication' 
      });

      expect(result.llmContent).toContain('Added task task-1');
      expect(result.llmContent).toContain('Implement authentication');
      expect(result.returnDisplay).toContain('Current: [task-1] Implement authentication');
    });

    it('should add task at specific position', async () => {
      await taskTool.execute({ operation: 'add', description: 'First task' });
      await taskTool.execute({ operation: 'add', description: 'Second task' });
      
      const result = await taskTool.execute({ 
        operation: 'add', 
        description: 'Inserted task',
        position: 1 
      });

      expect(result.llmContent).toContain('at position 1');
      expect(result.returnDisplay).toContain('Current: [task-1] First task');
      expect(result.returnDisplay).toContain('[task-3] Inserted task');
      expect(result.returnDisplay).toContain('[task-2] Second task');
    });

    it('should make first task active when added to empty list', async () => {
      const result = await taskTool.execute({ 
        operation: 'add', 
        description: 'First task' 
      });

      expect(result.returnDisplay).toContain('Current: [task-1] First task');
      expect(result.returnDisplay).not.toContain('Pending:');
    });
  });

  describe('list operation', () => {
    it('should show empty state correctly', async () => {
      const result = await taskTool.execute({ operation: 'list' });
      
      expect(result.returnDisplay).toContain('Current: No active task');
      expect(result.returnDisplay).toContain('No pending tasks');
    });

    it('should show all sections when populated', async () => {
      // Add tasks
      await taskTool.execute({ operation: 'add', description: 'Task 1' });
      await taskTool.execute({ operation: 'add', description: 'Task 2' });
      await taskTool.execute({ operation: 'add', description: 'Task 3' });
      
      // Complete one
      await taskTool.execute({ operation: 'complete' });
      
      const result = await taskTool.execute({ operation: 'list' });
      
      expect(result.returnDisplay).toContain('Current: [task-2] Task 2');
      expect(result.returnDisplay).toContain('Pending:');
      expect(result.returnDisplay).toContain('[task-3] Task 3');
      expect(result.returnDisplay).toContain('Completed (recent):');
      expect(result.returnDisplay).toContain('✓ [task-1] Task 1');
    });
  });

  describe('complete operation', () => {
    it('should complete current task when no ID provided', async () => {
      await taskTool.execute({ operation: 'add', description: 'Task 1' });
      await taskTool.execute({ operation: 'add', description: 'Task 2' });
      
      const result = await taskTool.execute({ operation: 'complete' });
      
      expect(result.llmContent).toContain('Completed task task-1');
      expect(result.returnDisplay).toContain('Current: [task-2] Task 2');
      expect(result.returnDisplay).toContain('✓ [task-1] Task 1');
    });

    it('should complete specific task by ID', async () => {
      await taskTool.execute({ operation: 'add', description: 'Task 1' });
      await taskTool.execute({ operation: 'add', description: 'Task 2' });
      await taskTool.execute({ operation: 'add', description: 'Task 3' });
      
      const result = await taskTool.execute({ operation: 'complete', id: 'task-2' });
      
      expect(result.llmContent).toContain('Completed task task-2');
      expect(result.returnDisplay).toContain('Current: [task-1] Task 1');
      expect(result.returnDisplay).toContain('[task-3] Task 3');
      expect(result.returnDisplay).toContain('✓ [task-2] Task 2');
    });

    it('should handle completing non-existent task', async () => {
      const result = await taskTool.execute({ operation: 'complete', id: 'task-999' });
      expect(result.llmContent).toContain('Error: Task task-999 not found');
    });

    it('should handle completing when no tasks exist', async () => {
      const result = await taskTool.execute({ operation: 'complete' });
      expect(result.llmContent).toContain('Error: No pending tasks to complete');
    });

    it('should maintain only last 5 completed tasks', async () => {
      // Add and complete 7 tasks
      for (let i = 1; i <= 7; i++) {
        await taskTool.execute({ operation: 'add', description: `Task ${i}` });
        await taskTool.execute({ operation: 'complete' });
      }
      
      const result = await taskTool.execute({ operation: 'list' });
      
      // Should only show task-3 through task-7 in completed
      expect(result.returnDisplay).toContain('✓ [task-7]');
      expect(result.returnDisplay).toContain('✓ [task-6]');
      expect(result.returnDisplay).toContain('✓ [task-5]');
      expect(result.returnDisplay).toContain('✓ [task-4]');
      expect(result.returnDisplay).toContain('✓ [task-3]');
      expect(result.returnDisplay).not.toContain('✓ [task-2]');
      expect(result.returnDisplay).not.toContain('✓ [task-1]');
    });
  });

  describe('update operation', () => {
    it('should update task description', async () => {
      await taskTool.execute({ operation: 'add', description: 'Original description' });
      
      const result = await taskTool.execute({ 
        operation: 'update', 
        id: 'task-1',
        description: 'Updated description' 
      });
      
      expect(result.llmContent).toContain('Updated task task-1');
      expect(result.llmContent).toContain('from "Original description"');
      expect(result.llmContent).toContain('to "Updated description"');
      expect(result.returnDisplay).toContain('[task-1] Updated description');
    });

    it('should handle updating non-existent task', async () => {
      const result = await taskTool.execute({ 
        operation: 'update', 
        id: 'task-999',
        description: 'New description' 
      });
      
      expect(result.llmContent).toContain('Error: Task task-999 not found');
    });

    it('should not allow updating completed tasks', async () => {
      await taskTool.execute({ operation: 'add', description: 'Task 1' });
      await taskTool.execute({ operation: 'complete' });
      
      const result = await taskTool.execute({ 
        operation: 'update', 
        id: 'task-1',
        description: 'Try to update completed' 
      });
      
      expect(result.llmContent).toContain('Error: Task task-1 not found in pending tasks');
    });
  });

  describe('task numbering', () => {
    it('should maintain incrementing task IDs across operations', async () => {
      await taskTool.execute({ operation: 'add', description: 'Task 1' });
      await taskTool.execute({ operation: 'add', description: 'Task 2' });
      await taskTool.execute({ operation: 'complete' });
      await taskTool.execute({ operation: 'add', description: 'Task 3' });
      
      const result = await taskTool.execute({ operation: 'list' });
      
      expect(result.returnDisplay).toContain('[task-2]');
      expect(result.returnDisplay).toContain('[task-3]');
      expect(result.returnDisplay).toContain('✓ [task-1]');
    });
  });

  describe('getDescription', () => {
    it('should provide descriptive summaries for each operation', () => {
      expect(taskTool.getDescription({ operation: 'add', description: 'Do something' }))
        .toBe('Add task: Do something');
      
      expect(taskTool.getDescription({ operation: 'list' }))
        .toBe('List all tasks');
      
      expect(taskTool.getDescription({ operation: 'complete' }))
        .toBe('Complete current task');
      
      expect(taskTool.getDescription({ operation: 'complete', id: 'task-1' }))
        .toBe('Complete task task-1');
      
      expect(taskTool.getDescription({ operation: 'update', id: 'task-1' }))
        .toBe('Update task task-1');
    });
  });
});