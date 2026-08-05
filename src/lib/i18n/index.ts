import { i18n } from "@lingui/core";
import type { SupportedLocale } from "./schema.ts";

export const locales: SupportedLocale[] = ["ja", "en", "zh_CN", "es", "fr", "pt"];

const importMessages = async (locale: SupportedLocale) => {
  switch (locale) {
    case "ja":
      return import("./locales/ja/messages.ts");
    case "en":
      return import("./locales/en/messages.ts");
    case "zh_CN":
      return import("./locales/zh_CN/messages.ts");
    case "es":
      return import("./locales/es/messages.ts");
    case "fr":
      return import("./locales/fr/messages.ts");
    case "pt":
      return import("./locales/pt/messages.ts");
    default:
      locale satisfies never;
      throw new Error(`Unsupported locale: ${String(locale)}`);
  }
};

const loadedLocales: SupportedLocale[] = [];
export const activateLocale = async (locale: SupportedLocale) => {
  if (!loadedLocales.includes(locale)) {
    const { messages } = await importMessages(locale);
    i18n.load(locale, messages);
    loadedLocales.push(locale);
  }

  i18n.activate(locale);
};
