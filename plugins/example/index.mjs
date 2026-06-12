// Example open-agent plugin (s19).
// Plain JavaScript so it loads without a build step.
// In production this would wrap an MCP stdio server or a REST API.

const tools = [
  {
    name: "now",
    description: "Return the current ISO 8601 timestamp in UTC.",
    input_schema: { type: "object", properties: {} },
    handler: async () => new Date().toISOString(),
  },
  {
    name: "uppercase",
    description: "Convert a string to upper case. Useful for testing plugin wiring.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    handler: async (input) => String(input.text ?? "").toUpperCase(),
  },
];

export default {
  name: "example",
  tools,
};
