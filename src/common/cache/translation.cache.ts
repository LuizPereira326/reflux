import * as fs from "fs"
import * as path from "path"

const CACHE_FILE = path.resolve(process.cwd(), "translations.json")

let cache: Record<string, string> = {}

if (fs.existsSync(CACHE_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
  } catch {
    cache = {}
  }
}

export function getCachedTranslation(key: string): string | null {
  return cache[key] ?? null
}

export function setCachedTranslation(key: string, value: string) {
  cache[key] = value
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
}

