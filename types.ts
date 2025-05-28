
export enum Intent {
  TECHNICAL_SUPPORT = "Technical Support",
  PRODUCT_FEATURE_REQUEST = "Product Feature Request",
  SALES_LEAD = "Sales Lead",
  UNKNOWN = "Unknown",
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent' | 'system';
  timestamp: Date;
  intent?: Intent;
  topic?: string; // Extracted topic from classification
}

export interface IntentClassification {
  intent: Intent;
  topic?: string | null; // e.g., "password reset", "dark mode"
}

export interface KBSearchResult {
  snippet: string | null;
  relevantTopic: string | null; // e.g., "How do I reset my password?"
}

export interface EscalationDecision {
  escalate: boolean;
  reason: string | null;
}
