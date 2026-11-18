// Shape of GET /api/admin/growth (secrets are never included).
interface Status {
  lastOkAt: string | null;
  lastError: string;
}

export interface GrowthView {
  siteUrl: string;
  base: string; // '' while the Site URL is not a public address
  share: {
    telegram: Status & { enabled: boolean; channel: string; botReady: boolean; botUsername: string; ready: boolean };
    x: Status & { enabled: boolean; has: { apiKey: boolean; apiSecret: boolean; accessToken: boolean; accessSecret: boolean }; last4: string; ready: boolean };
    linkedin: Status & { enabled: boolean; hasToken: boolean; last4: string; author: string; version: string; versionUsed: string; ready: boolean };
    facebook: Status & { enabled: boolean; pageId: string; hasToken: boolean; last4: string; ready: boolean };
    hashtags: number;
    includeTranslations: boolean;
    lastSkipped: string;
  };
  newsletter: Status & {
    provider: 'none' | 'brevo' | 'resend';
    hasKey: boolean;
    last4: string;
    fromEmail: string;
    fromName: string;
    replyTo: string;
    doubleOptIn: boolean;
    digest: { enabled: boolean; day: number; time: string; maxPosts: number; lastSentDay: string };
    ready: boolean;
    history: { at: string; kind: string; subject: string; posts: number; sent: number; failed: number; note: string }[];
    subscribers: { subscribed: number; pending: number; unsubscribed: number };
    timezone: string;
  };
  indexnow: { enabled: boolean; key: string; keyUrl: string; lastPingAt: string | null; lastResult: string };
  links: { enabled: boolean; maxPerArticle: number; backfill: boolean };
  translation: {
    hindi: boolean;
    autoPublish: boolean;
    queued: number;
    recent: { _id: string; status: string; error: string; createdAt: string; source?: { _id: string; title: string } | null; article?: { _id: string; title: string; slug: string; status: string } | null }[];
  };
  refresh: { perWeek: number; minAgeDays: number; lastStartedAt?: string; lastResult: string };
  photos: { available: boolean; missing: number };
}
