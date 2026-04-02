import Anthropic from "@anthropic-ai/sdk";

const PROXY = process.env.ANTHROPIC_BASE_URL;
if (!PROXY) throw new Error("ANTHROPIC_BASE_URL 未设置");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "dummy",
  fetch: ((_url: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(PROXY, init)) as typeof globalThis.fetch,
});

const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 64,
  messages: [{ role: "user", content: "Say hi" }],
});

console.log(response.content[0]);
