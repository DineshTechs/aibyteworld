import mongoose from 'mongoose';

export const PROVIDER_KEYS = ['gemini', 'openai', 'anthropic', 'tavily', 'nous', 'groq', 'cerebras', 'mistral', 'openrouter', 'ollama', 'unsplash', 'pexels', 'pixabay', 'openverse', 'wikimedia', 'nasa'];

// One document per provider. The API key is stored encrypted (AES-256-GCM);
// only its last four characters are ever returned by the API.
const aiProviderSchema = new mongoose.Schema(
  {
    key: { type: String, enum: PROVIDER_KEYS, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    model: { type: String, default: '', maxlength: 120 },
    modelOutputLimit: { type: Number }, // max output tokens of the selected model
    baseUrl: { type: String, default: '', maxlength: 300 }, // Ollama only
    // Recent failures per role (research | writer | image): the provider is
    // skipped until `until`, then tried first again. { [role]: { until, code, message, at } }
    health: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    apiKey: {
      iv: { type: String, select: false },
      tag: { type: String, select: false },
      data: { type: String, select: false },
    },
    apiKeyLast4: { type: String, default: '' },
    lastTest: {
      at: { type: Date },
      ok: { type: Boolean },
      message: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

aiProviderSchema.methods.toSafe = function toSafe() {
  return {
    key: this.key,
    enabled: this.enabled,
    isDefault: this.isDefault,
    model: this.model,
    baseUrl: this.baseUrl,
    hasKey: Boolean(this.apiKeyLast4),
    apiKeyLast4: this.apiKeyLast4,
    lastTest: this.lastTest?.at ? this.lastTest : null,
    updatedAt: this.updatedAt,
  };
};

export const AIProvider = mongoose.model('AIProvider', aiProviderSchema);
