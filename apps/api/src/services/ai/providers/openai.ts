import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { MappingSchema, type LlmProvider } from "../types.js";

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai" as const;
  private client: OpenAI;
  constructor(apiKey: string, private model = "gpt-4.1") {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async mapFields(system: string, user: string) {
    const r = await this.client.chat.completions.parse({
      model: this.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: zodResponseFormat(MappingSchema, "field_mapping"),
    });
    const parsed = r.choices[0]?.message.parsed;
    if (!parsed) throw new Error("openai returned no parsed output");
    return {
      result: parsed,
      usage: {
        model: this.model,
        inputTokens: r.usage?.prompt_tokens ?? 0,
        outputTokens: r.usage?.completion_tokens ?? 0,
        costUsd: 0, // filled by pricing table in config
      },
    };
  }

  async ping() {
    await this.client.models.retrieve(this.model);
  }
}
