import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { SiteSettings } from '../types';

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'Blog',
  tagline: '',
  description: '',
  siteUrl: '',
  contactEmail: '',
  contactAddress: '',
  social: { twitter: '', facebook: '', linkedin: '', instagram: '' },
  pages: { about: '', privacy: '', terms: '' },
  postsPerPage: 9,
  allowIndexing: true,
  analytics: { enabled: true, gaMeasurementId: '', gtmContainerId: '', consentBanner: true },
};

const SettingsContext = createContext<{ settings: SiteSettings; loaded: boolean; refresh: () => void }>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  refresh: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    api
      .get<{ settings: SiteSettings }>('/public/settings')
      .then((r) => setSettings({ ...DEFAULT_SETTINGS, ...r.settings }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(refresh, [refresh]);
  return <SettingsContext.Provider value={{ settings, loaded, refresh }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
