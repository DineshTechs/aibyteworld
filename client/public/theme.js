// Applies the saved light/dark theme before the page paints, to avoid a flash.
try {
  var t = localStorage.getItem('blogsite_theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
