// Built-in source registry. Every entry is a CANDIDATE: the feed address has not been verified
// from the build environment. The app tests each feed itself during discovery and records the
// outcome. A source that fails is flagged and never treated as "searched, nothing found".
//
// Scope format: "<Region> · <Country or scope>". Regions: Africa, Asia, Europe, Latin America,
// Middle East, North America, Oceania, Global.
// tier: "primary" = the institution itself (official statements, journals, legislation);
//       "reporting" = a news organisation reporting on events.
// US and UK sources are deliberately capped (see SEED_SOURCES tests).

export type Seed = {
  name: string;
  publisher: string;
  scope: string;
  category: string;
  feed: string;
  site: string;
  tier: "primary" | "reporting";
};

const L = "Laws and regulations";
const G = "Government and institutional decisions";
const S = "Scientific discoveries";
const T = "Technology";
const B = "Business and economic developments";
const E = "Environment and climate";
const P = "Public policy";
const I = "International affairs";
const W = "General world news";

export const SEED_SOURCES: Seed[] = [
  // Global / international institutions and science
  { name: "UN News", publisher: "United Nations", scope: "Global · United Nations", category: I, feed: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", site: "https://news.un.org", tier: "primary" },
  { name: "WHO News", publisher: "World Health Organization", scope: "Global · WHO", category: P, feed: "https://www.who.int/rss-feeds/news-english.xml", site: "https://www.who.int/news", tier: "primary" },
  { name: "Nature", publisher: "Nature Portfolio", scope: "Global · Research journal", category: S, feed: "https://www.nature.com/nature.rss", site: "https://www.nature.com/nature", tier: "primary" },
  { name: "Mongabay", publisher: "Mongabay", scope: "Global · Environment", category: E, feed: "https://news.mongabay.com/feed/", site: "https://news.mongabay.com", tier: "reporting" },
  { name: "Phys.org", publisher: "Science X", scope: "Global · Research news", category: S, feed: "https://phys.org/rss-feed/", site: "https://phys.org", tier: "reporting" },
  { name: "KrASIA", publisher: "KrASIA", scope: "Asia · Regional technology", category: T, feed: "https://kr-asia.com/feed", site: "https://kr-asia.com", tier: "reporting" },
  // Africa
  { name: "Africanews", publisher: "Africanews", scope: "Africa · Pan-African", category: W, feed: "https://www.africanews.com/feed/rss", site: "https://www.africanews.com", tier: "reporting" },
  { name: "Daily Maverick", publisher: "Daily Maverick", scope: "Africa · South Africa", category: G, feed: "https://www.dailymaverick.co.za/dmrss/", site: "https://www.dailymaverick.co.za", tier: "reporting" },
  { name: "Premium Times", publisher: "Premium Times", scope: "Africa · Nigeria", category: G, feed: "https://www.premiumtimesng.com/feed", site: "https://www.premiumtimesng.com", tier: "reporting" },
  { name: "Techpoint Africa", publisher: "Techpoint Africa", scope: "Africa · Nigeria", category: T, feed: "https://techpoint.africa/feed/", site: "https://techpoint.africa", tier: "reporting" },
  { name: "TechCabal", publisher: "TechCabal", scope: "Africa · Nigeria", category: T, feed: "https://techcabal.com/feed/", site: "https://techcabal.com", tier: "reporting" },
  // Asia
  { name: "The Hindu (National)", publisher: "The Hindu", scope: "Asia · India", category: G, feed: "https://www.thehindu.com/news/national/feeder/default.rss", site: "https://www.thehindu.com", tier: "reporting" },
  { name: "Japan Times", publisher: "The Japan Times", scope: "Asia · Japan", category: W, feed: "https://www.japantimes.co.jp/feed/", site: "https://www.japantimes.co.jp", tier: "reporting" },
  { name: "CNA", publisher: "Channel NewsAsia", scope: "Asia · Singapore", category: B, feed: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", site: "https://www.channelnewsasia.com", tier: "reporting" },
  { name: "Dawn", publisher: "Dawn", scope: "Asia · Pakistan", category: G, feed: "https://www.dawn.com/feeds/home", site: "https://www.dawn.com", tier: "reporting" },
  { name: "South China Morning Post", publisher: "SCMP", scope: "Asia · Hong Kong", category: B, feed: "https://www.scmp.com/rss/91/feed", site: "https://www.scmp.com", tier: "reporting" },
  // Europe
  { name: "Deutsche Welle", publisher: "Deutsche Welle", scope: "Europe · Germany", category: I, feed: "https://rss.dw.com/rdf/rss-en-all", site: "https://www.dw.com", tier: "reporting" },
  { name: "France 24", publisher: "France Médias Monde", scope: "Europe · France", category: I, feed: "https://www.france24.com/en/rss", site: "https://www.france24.com", tier: "reporting" },
  { name: "Euronews", publisher: "Euronews", scope: "Europe · Pan-European", category: P, feed: "https://www.euronews.com/rss", site: "https://www.euronews.com", tier: "reporting" },
  { name: "ECB Press", publisher: "European Central Bank", scope: "Europe · Euro area", category: B, feed: "https://www.ecb.europa.eu/rss/press.xml", site: "https://www.ecb.europa.eu/press", tier: "primary" },
  // Latin America
  { name: "MercoPress", publisher: "MercoPress", scope: "Latin America · South Atlantic and Mercosur", category: I, feed: "https://en.mercopress.com/rss", site: "https://en.mercopress.com", tier: "reporting" },
  { name: "Mexico News Daily", publisher: "Mexico News Daily", scope: "Latin America · Mexico", category: G, feed: "https://mexiconewsdaily.com/feed/", site: "https://mexiconewsdaily.com", tier: "reporting" },
  { name: "Buenos Aires Times", publisher: "Buenos Aires Times", scope: "Latin America · Argentina", category: G, feed: "https://www.batimes.com.ar/feed", site: "https://www.batimes.com.ar", tier: "reporting" },
  // Middle East
  { name: "Al Jazeera", publisher: "Al Jazeera Media Network", scope: "Middle East · Qatar", category: I, feed: "https://www.aljazeera.com/xml/rss/all.xml", site: "https://www.aljazeera.com", tier: "reporting" },
  { name: "Arab News", publisher: "Arab News", scope: "Middle East · Saudi Arabia", category: B, feed: "https://www.arabnews.com/rss.xml", site: "https://www.arabnews.com", tier: "reporting" },
  { name: "The National", publisher: "The National", scope: "Middle East · United Arab Emirates", category: B, feed: "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml", site: "https://www.thenationalnews.com", tier: "reporting" },
  { name: "Middle East Eye", publisher: "Middle East Eye", scope: "Middle East · Regional", category: I, feed: "https://www.middleeasteye.net/rss", site: "https://www.middleeasteye.net", tier: "reporting" },
  // Oceania
  { name: "ABC News Australia", publisher: "Australian Broadcasting Corporation", scope: "Oceania · Australia", category: G, feed: "https://www.abc.net.au/news/feed/51120/rss.xml", site: "https://www.abc.net.au/news", tier: "reporting" },
  { name: "RNZ World", publisher: "Radio New Zealand", scope: "Oceania · New Zealand", category: I, feed: "https://www.rnz.co.nz/rss/world.xml", site: "https://www.rnz.co.nz", tier: "reporting" },
  { name: "RNZ Pacific", publisher: "Radio New Zealand", scope: "Oceania · Pacific Islands", category: I, feed: "https://www.rnz.co.nz/rss/pacific.xml", site: "https://www.rnz.co.nz/international/pacific-news", tier: "reporting" },
  { name: "The Conversation (Australia)", publisher: "The Conversation", scope: "Oceania · Australia", category: S, feed: "https://theconversation.com/au/articles.atom", site: "https://theconversation.com/au", tier: "reporting" },
  // North America (US and UK entries are intentionally few)
  { name: "CBC Top Stories", publisher: "Canadian Broadcasting Corporation", scope: "North America · Canada", category: G, feed: "https://www.cbc.ca/webfeed/rss/rss-topstories", site: "https://www.cbc.ca/news", tier: "reporting" },
  { name: "NASA News", publisher: "NASA", scope: "North America · United States", category: S, feed: "https://www.nasa.gov/feed/", site: "https://www.nasa.gov/news", tier: "primary" },
  { name: "JURIST", publisher: "JURIST", scope: "North America · United States", category: L, feed: "https://www.jurist.org/news/feed/", site: "https://www.jurist.org", tier: "reporting" },
  { name: "UK Legislation (new)", publisher: "The National Archives", scope: "Europe · United Kingdom", category: L, feed: "https://www.legislation.gov.uk/new/data.feed", site: "https://www.legislation.gov.uk", tier: "primary" },
];

export const regionOf = (scope: string | null | undefined) => (scope ?? "").split(" · ")[0] || "Unknown";
export const isUsOrUk = (scope: string) => /United States|United Kingdom/.test(scope);
