// Google Consent Mode defaults, loaded before Google's tags (see seoService.js).
// Until the visitor accepts cookies, Google tags run without cookies and send
// only anonymous, cookie-free pings. Signed-in staff are not measured at all.
(function () {
  var me = document.currentScript;
  if (!me) return;
  var ga = me.getAttribute('data-ga') || '';
  var gtm = me.getAttribute('data-gtm') || '';
  var ask = me.getAttribute('data-ask') !== '0';
  var consent = null;
  var staff = false;
  try {
    consent = localStorage.getItem('blogsite_consent');
    staff = Boolean(localStorage.getItem('blogsite_token'));
  } catch (e) {
    /* storage unavailable: treat as a new visitor */
  }
  var granted = !staff && (!ask || consent === 'granted');
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    // gtag must push the arguments object itself.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  if (staff && ga) window['ga-disable-' + ga] = true;
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: granted ? 'granted' : 'denied',
    wait_for_update: 500,
  });
  window.gtag('js', new Date());
  // Page views are sent by the site on every page change (it is a single-page app).
  if (ga) window.gtag('config', ga, { send_page_view: false });
  if (gtm) window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  window.__siteTags = { ga: ga, gtm: gtm, staff: staff };
})();
