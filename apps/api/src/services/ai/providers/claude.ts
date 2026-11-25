import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MappingSchema, type LlmProvider } from "../types.js";

// USD per 1M tokens — keep in sync with the pricing page; used for cost dashboards only.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};

export class ClaudeProvider implements LlmProvider {
  readonly name = "claude" as const;
  private client: Anthropic;
  constructor(apiKey: string, private model = "claude-opus-5-5") {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async mapFields(system: string, user: string) {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      // Field mapping is a bounded classification task: low effort keeps latency/cost down without hurting accuracy.
      output_config: { effort: "low", format: zodOutputFormat(MappingSchema) },
      // The system prompt (instructions + profile vocabulary) is stable per profile → cache it.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") throw new Error("claude declined the mapping request");
    if (!response.parsed_output) throw new Error(`claude returned unparseable output (stop_reason=${response.stop_reason})`);
    const p = PRICING[this.model] ?? { in: 4, out: 20 };
    const u = response.usage;
    return {
      result: response.parsed_output,
      usage: {
        model: this.model,
        inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens,
        costUsd: (u.input_tokens * p.in + (u.cache_read_input_tokens ?? 0) * p.in * 0.1 + u.output_tokens * p.out) / 1e6,
      },
    };
  }

  async ping() {
    await this.client.models.retrieve(this.model);
  }
}
