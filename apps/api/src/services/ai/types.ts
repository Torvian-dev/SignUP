import { z } from "zod";

/** What the analyser extracts for each field — sent to the LLM (no profile values). */
export interface FieldDescriptor {
  id: string;            // detected_fields.id
  kind: string;          // text|email|tel|select|checkbox|radio|date|file|password|...
  label?: string;
  name?: string;
  htmlId?: string;
  placeholder?: string;
  autocomplete?: string;
  ariaLabel?: string;
  nearbyText?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  section?: string;      // fieldset legend / heading
}

export const MappingSchema = z.object({
  mappings: z.array(z.object({
    fieldId: z.string(),
    profilePath: z.string().nullable().describe("Profile slot path, or null if no slot fits"),
    transform: z.string().nullable().describe("Optional transform: date:DD/MM/YYYY, phone:national, phone:e164, country:name, country:alpha2, option:<value>, split:first, split:last, bool:true, bool:false"),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().describe("One sentence explaining the choice"),
  })),
  pageKind: z.enum(["signup", "login", "application", "contact", "checkout", "verification", "onboarding", "other"]),
  submitLocatorHint: z.string().nullable().describe("Visible text of the button that advances/submits this form"),
});
export type MappingResult = z.infer<typeof MappingSchema>;

export interface LlmUsage { inputTokens: number; outputTokens: number; costUsd: number; model: string }

export interface LlmProvider {
  readonly name: "claude" | "openai" | "gemini";
  /** Structured field mapping. Must return JSON matching MappingSchema. */
  mapFields(system: string, user: string): Promise<{ result: MappingResult; usage: LlmUsage }>;
  /** Cheap connectivity check used by the admin "Test connection" button. */
  ping(): Promise<void>;
}
