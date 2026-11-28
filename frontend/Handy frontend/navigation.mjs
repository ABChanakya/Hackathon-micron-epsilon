/** Return a cockpit link for the unified app or the phone server's configured backend. */
export function cockpitUrl(href, backendPort, language, route = 'monitor') {
  const url = new URL(href);
  const unified = /^\/handy(?:\/|$)/.test(url.pathname);
  if (!unified) url.port = Number.isInteger(backendPort) && backendPort > 0 && backendPort <= 65535 ? String(backendPort) : '8000';
  url.pathname = '/';
  url.search = '';
  if (language) url.searchParams.set('lang', language);
  url.hash = route === 'advanced' ? 'advanced' : 'monitor';
  return url.toString();
}
