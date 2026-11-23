import { AnimeSama } from "./anime-sama.js"
import { MangaOrigins } from "./manga-origins.js"
import { SushiScan } from "./sushiscan.js"
import { SushiScanNet } from "./sushiscan-net.js"

export const sites = {
  "sushiscan": { make: SushiScan, defaultUrl: "https://sushiscan.fr" },
  "sushiscan-net": { make: SushiScanNet, defaultUrl: "https://sushiscan.net" },
  "manga-origins": { make: MangaOrigins, defaultUrl: "https://mangas-origines.fr" },
  "anime-sama": { make: AnimeSama, defaultUrl: "https://anime-sama.to" }
}

export type SiteName = keyof typeof sites
