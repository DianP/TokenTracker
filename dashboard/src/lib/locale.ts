import { safeGetItem, safeSetItem } from "./safe-browser";

export const LOCALE_STORAGE_KEY = "tokentracker-locale";
export const SYSTEM_LOCALE = "system";
export const EN_LOCALE = "en";
export const ZH_CN_LOCALE = "zh-CN";

export function normalizeResolvedLocale(value: any) {
  if (typeof value !== "string") return EN_LOCALE;
  return /^zh(?:[-_]|$)/i.test(value.trim()) ? ZH_CN_LOCALE : EN_LOCALE;
}

export function normalizeLocalePreference(value: any) {
  if (value === SYSTEM_LOCALE) return SYSTEM_LOCALE;
  return normalizeResolvedLocale(value);
}

function getBrowserLanguages() {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) {
    return navigator.languages.filter((value) => typeof value === "string");
  }
  return typeof navigator.language === "string" ? [navigator.language] : [];
}

export function resolvePreferredLocale(preference: any, languages = getBrowserLanguages()) {
  const normalized = normalizeLocalePreference(preference);
  if (normalized !== SYSTEM_LOCALE) return normalized;
  const matched = languages.find((value) => /^zh(?:[-_]|$)/i.test(String(value).trim()));
  return matched ? ZH_CN_LOCALE : EN_LOCALE;
}

export function getInitialLocalePreference() {
  return normalizeLocalePreference(safeGetItem(LOCALE_STORAGE_KEY) || SYSTEM_LOCALE);
}

export function persistLocalePreference(preference: any) {
  return safeSetItem(LOCALE_STORAGE_KEY, normalizeLocalePreference(preference));
}
