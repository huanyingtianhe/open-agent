// s19 MCP & Plugins.
//
// "External capabilities join the same routing, permission, and result-append
// path as native tools." -- i.e. once they're in the registry, the loop
// doesn't know or care that they're external.
//
// This loader scans a `plugins/` directory. Each plugin is a folder with an
// index.js (or index.ts via tsx) that default-exports:
//
//   export default {
//     name: "my-plugin",
//     tools: [ <ToolDefinition>, ... ]
//   }
//
// For a real MCP integration, write a single plugin whose tools wrap stdio
// MCP server calls. The loop above stays the same -- only the handler bodies
// change. That's the whole point of s19.

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "../types.js";

export interface PluginManifest {
  name: string;
  tools: ToolDefinition[];
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  source: string;
}

export class PluginLoader {
  constructor(private dir: string) {}

  async loadAll(): Promise<LoadedPlugin[]> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return [];
    }

    const plugins: LoadedPlugin[] = [];
    for (const name of entries) {
      const sub = path.join(this.dir, name);
      const stat = await fs.stat(sub).catch(() => null);
      if (!stat?.isDirectory()) continue;

      // Try common entry points
      const candidates = ["index.js", "index.mjs", "index.cjs"];
      let entry: string | null = null;
      for (const c of candidates) {
        const p = path.join(sub, c);
        if (await exists(p)) {
          entry = p;
          break;
        }
      }
      if (!entry) continue;

      try {
        const mod = await import(pathToFileURL(entry).href);
        const manifest = (mod.default ?? mod) as PluginManifest;
        if (!manifest?.name || !Array.isArray(manifest.tools)) {
          throw new Error("plugin must export { name, tools[] }");
        }
        plugins.push({ manifest, source: entry });
      } catch (err) {
        // Log but don't crash -- one bad plugin shouldn't break the agent.
        // eslint-disable-next-line no-console
        console.error(`[plugin] failed to load ${name}: ${(err as Error).message}`);
      }
    }
    return plugins;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
