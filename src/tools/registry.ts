// Tool registry: name -> definition.
// Adding a tool means inserting one entry here. The agent loop never changes.

import type { ToolDefinition } from "../types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any>>();

  register<TI, TO>(tool: ToolDefinition<TI, TO>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as ToolDefinition<any, any>);
  }

  get(name: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  // Return a subset by name, for subagents that get an allow-list.
  subset(names: string[]): ToolDefinition[] {
    return names
      .map((n) => this.tools.get(n))
      .filter((t): t is ToolDefinition<any, any> => t !== undefined);
  }
}
