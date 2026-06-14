export type ChatMessage = { role: string; content: string };

export type ContextRoute = {
  tier: "small" | "large";
  expected_pool: string;
  expected_model: string;
  over_threshold: boolean;
};

export function calcMessagesBytes(messages: ChatMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).length;
}

export function inferTierFromResponse(
  responseModel: string | null,
  smallModel: string,
  largeModel: string
): "small" | "large" | "unknown" {
  if (!responseModel) return "unknown";
  if (responseModel === largeModel) return "large";
  if (responseModel === smallModel) return "small";
  return "unknown";
}
