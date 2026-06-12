// Tiny logger with color-coded prefixes. No deps.

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

export const log = {
  user: (s: string) => console.log(`${c.cyan}user>${c.reset} ${s}`),
  assistant: (s: string) => console.log(`${c.green}agent>${c.reset} ${s}`),
  tool: (name: string, s: string) =>
    console.log(`${c.magenta}tool[${name}]${c.reset} ${c.dim}${truncate(s)}${c.reset}`),
  info: (s: string) => console.log(`${c.dim}${s}${c.reset}`),
  warn: (s: string) => console.log(`${c.yellow}warn${c.reset} ${s}`),
  error: (s: string) => console.log(`${c.red}error${c.reset} ${s}`),
};

function truncate(s: string, max = 400): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (+${s.length - max} chars)`;
}
