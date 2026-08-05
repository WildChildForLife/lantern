import z from "zod";

export const localeSchema = z.enum(["ja", "en", "zh_CN", "es", "fr", "pt"]);
export type SupportedLocale = z.infer<typeof localeSchema>;
