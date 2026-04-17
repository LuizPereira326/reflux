import axios from "axios"
import { getCachedTranslation, setCachedTranslation } from "@/cache/translation.cache"

const ENDPOINT = "https://libretranslate.com/translate"

// detecta coreano/japonês/chinês
export function hasCJK(text?: string): boolean {
  if (!text) return false
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(text)
}

// tradução NÃO bloqueante + cache
export async function translateEpisodeAsync(text: string) {
  // não traduz se já existe cache
  if (getCachedTranslation(text)) return

  try {
    const res = await axios.post(
      ENDPOINT,
      {
        q: text,
        source: "auto",
        target: "pt",
        format: "text",
      },
      { timeout: 4000 },
    )

    const translated = res.data?.translatedText
    if (translated) {
      setCachedTranslation(text, translated)
    }
  } catch {
    // falha silenciosa por design (produção)
  }
}

