---
name: code-search
description: Multi-step recipe for searching a codebase. Use when the user asks to find symbols, functions, or text patterns across many files.
---

# Code Search Skill

Follow this recipe to answer code-search questions efficiently:

1. **Narrow first.** Ask `run_shell` to list the top-level directory structure
   (`ls`, `dir`, or `git ls-files | head -50`). Pick the most likely subtree.
2. **Search with ripgrep when available**, falling back to `findstr` on Windows
   or `grep -rn` on Unix. Always pass a path filter and a sane line limit
   (`rg <pattern> <subdir> | head -50`).
3. **Read only the files that matter.** Use `read_file` with `start_line` /
   `end_line` for any file larger than 10 KB. Never load an entire 200 KB file
   if 30 lines will answer the question.
4. **Delegate breadth via subagent.** When the search returns 20+ candidate
   files across unrelated modules, spawn a `subagent` per module with a
   focused prompt and `allowed_tools: ["read_file", "run_shell"]`.
5. **Report concisely.** Give the user file path + line range + a 1-line
   explanation per hit. Don't paste large code blocks unless asked.
