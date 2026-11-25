import { AnimeSama } from "./anime-sama.js"
import { MangaOrigins } from "./manga-origins.js"
import { SushiScan } from "./sushiscan.js"
import { SushiScanNet } from "./sushiscan-net.js"
import { WeebCentral } from "./weebcentral.js"

export const sites = {
  "sushiscan": { make: SushiScan, defaultUrl: "https://sushiscan.fr", lang: "fr-FR" },
  "sushiscan-net": { make: SushiScanNet, defaultUrl: "https://sushiscan.net", lang: "fr-FR" },
  "manga-origins": { make: MangaOrigins, defaultUrl: "https://mangas-origines.fr", lang: "fr-FR" },
  "anime-sama": { make: AnimeSama, defaultUrl: "https://anime-sama.to", lang: "fr-FR" },
  "weebcentral": { make: WeebCentral, defaultUrl: "https://weebcentral.com", lang: "en-US" }
}

export type SiteName = keyof typeof sites
