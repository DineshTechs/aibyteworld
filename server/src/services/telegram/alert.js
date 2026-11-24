// Telegram alerts for background problems, loaded lazily so services can use
// them without import cycles. Never throws.
export async function alertSystem(key, message, opts) {
  try {
    const { notifySystem } = await import('./bot.js');
    await notifySystem(key, message, opts);
  } catch {
    /* Telegram is optional */
  }
}
