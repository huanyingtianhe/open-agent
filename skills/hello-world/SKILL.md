---
name: hello-world
description: Demonstrates the s05 skill loading pattern. Loads a multi-step recipe only when the user explicitly asks for a "hello world" walkthrough.
---

# Hello World Skill

This skill exists to prove the progressive-disclosure pattern works:

1. Print `hello, world` using `run_shell` (`echo hello, world`).
2. Then create a file `hello.txt` with the same content using `write_file`.
3. Verify by `read_file` on `hello.txt`.
4. Report success.

Use this skill only when the user asks for a "hello world" demo. Don't load it
otherwise.
