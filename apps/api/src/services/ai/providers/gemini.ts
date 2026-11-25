import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { MappingSchema, type LlmProvider } from "../types.js";

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;
  private client: GoogleGenAI;
  constructor(apiKey: string, private model = "gemini-2.5-pro") {
    this.client = new GoogleGenAI({ apiKey });
  }

  async mapFields(system: string, user: string) {
    const r = await this.client.models.generateContent({
      model: this.model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(MappingSchema),
      },
    });
    const result = MappingSchema.parse(JSON.parse(r.text ?? "{}"));
    return {
      result,
      usage: {
        model: this.model,
        inputTokens: r.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0,
        costUsd: 0,
      },
    };
  }

  async ping() {
    await this.client.models.get({ model: this.model });
  }
}
