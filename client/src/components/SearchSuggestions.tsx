// Google Search Suggestions returned with grounded answers. Google requires them
// to be shown as provided wherever grounded results are displayed. They are
// rendered in a sandboxed frame (no scripts) so their CSS cannot affect the page,
// and links open in a new tab.
export function SearchSuggestions({ html }: { html: string }) {
  if (!html) return null;
  const doc = `<!doctype html><html><head><base target="_blank"><meta name="referrer" content="no-referrer"></head><body style="margin:0">${html}</body></html>`;
  return (
    <iframe
      title="Google Search suggestions"
      srcDoc={doc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      className="h-16 w-full rounded-lg border-0 bg-transparent"
    />
  );
}
