// Small built-in gazetteer for map grounding. NO network, NO paid service.
// Coordinates are APPROXIMATE country centroids (rounded) for placing a marker. They are not borders and not
// the location of any specific event. Claude must verify exact geometry from a reliable free map dataset.
import type { EvSource } from "./evidence-pack.mts";

type Place = { name: string; region: string; lat: number; lon: number };
const RAW = `Algeria|Africa|28|3;Angola|Africa|-12|18;Cameroon|Africa|6|12;Chad|Africa|15|19;DR Congo|Africa|-3|23;Egypt|Africa|27|30;Ethiopia|Africa|8|40;Ghana|Africa|8|-1;Kenya|Africa|0|38;Libya|Africa|27|17;Madagascar|Africa|-19|47;Mali|Africa|17|-4;Morocco|Africa|32|-6;Mozambique|Africa|-18|35;Namibia|Africa|-22|17;Niger|Africa|17|8;Nigeria|Africa|9|8;Rwanda|Africa|-2|30;Senegal|Africa|14|-14;Somalia|Africa|6|46;South Africa|Africa|-29|24;South Sudan|Africa|7|30;Sudan|Africa|15|30;Tanzania|Africa|-6|35;Tunisia|Africa|34|9;Uganda|Africa|1|32;Zambia|Africa|-14|28;Zimbabwe|Africa|-19|30;Afghanistan|Asia|34|66;Bangladesh|Asia|24|90;Cambodia|Asia|13|105;China|Asia|35|105;India|Asia|22|79;Indonesia|Asia|-2|118;Japan|Asia|36|138;Kazakhstan|Asia|48|67;Laos|Asia|18|103;Malaysia|Asia|4|102;Mongolia|Asia|47|104;Myanmar|Asia|21|96;Nepal|Asia|28|84;North Korea|Asia|40|127;Pakistan|Asia|30|70;Philippines|Asia|12|122;Singapore|Asia|1|104;South Korea|Asia|36|128;Sri Lanka|Asia|7|81;Taiwan|Asia|24|121;Thailand|Asia|15|101;Uzbekistan|Asia|41|64;Vietnam|Asia|16|106;Albania|Europe|41|20;Austria|Europe|47|14;Belarus|Europe|53|28;Belgium|Europe|51|5;Bulgaria|Europe|43|25;Croatia|Europe|45|16;Czech Republic|Europe|50|15;Denmark|Europe|56|10;Estonia|Europe|59|26;Finland|Europe|64|26;France|Europe|46|2;Germany|Europe|51|10;Greece|Europe|39|22;Hungary|Europe|47|19;Iceland|Europe|65|-19;Ireland|Europe|53|-8;Italy|Europe|42|12;Latvia|Europe|57|25;Lithuania|Europe|55|24;Netherlands|Europe|52|5;Norway|Europe|61|9;Poland|Europe|52|20;Portugal|Europe|39|-8;Romania|Europe|46|25;Russia|Europe|61|100;Serbia|Europe|44|21;Slovakia|Europe|48|19;Spain|Europe|40|-4;Sweden|Europe|62|15;Switzerland|Europe|47|8;Turkey|Europe|39|35;Ukraine|Europe|49|32;United Kingdom|Europe|54|-2;Argentina|Latin America|-34|-64;Bolivia|Latin America|-17|-65;Brazil|Latin America|-10|-52;Chile|Latin America|-30|-71;Colombia|Latin America|4|-72;Costa Rica|Latin America|10|-84;Cuba|Latin America|22|-79;Ecuador|Latin America|-2|-78;El Salvador|Latin America|14|-89;Guatemala|Latin America|15|-90;Haiti|Latin America|19|-72;Honduras|Latin America|15|-87;Mexico|Latin America|23|-102;Nicaragua|Latin America|13|-85;Panama|Latin America|9|-80;Paraguay|Latin America|-23|-58;Peru|Latin America|-10|-76;Uruguay|Latin America|-33|-56;Venezuela|Latin America|7|-66;Bahrain|Middle East|26|50;Iran|Middle East|32|53;Iraq|Middle East|33|44;Israel|Middle East|31|35;Jordan|Middle East|31|36;Kuwait|Middle East|29|48;Lebanon|Middle East|34|36;Oman|Middle East|21|57;Qatar|Middle East|25|51;Saudi Arabia|Middle East|24|45;Syria|Middle East|35|38;United Arab Emirates|Middle East|24|54;Yemen|Middle East|15|48;Canada|North America|56|-106;United States|North America|39|-98;Australia|Oceania|-25|134;Fiji|Oceania|-18|178;New Zealand|Oceania|-41|173;Papua New Guinea|Oceania|-6|144;Samoa|Oceania|-14|-172;Tonga|Oceania|-21|-175;Vanuatu|Oceania|-16|167`;
export const PLACES: Place[] = RAW.split(";").map((r) => {
  const [name, region, lat, lon] = r.split("|");
  return { name, region, lat: Number(lat), lon: Number(lon) };
});
const ALIASES: Record<string, string> = {
  UK: "United Kingdom", Britain: "United Kingdom", England: "United Kingdom", Scotland: "United Kingdom", Wales: "United Kingdom",
  US: "United States", USA: "United States", America: "United States", UAE: "United Arab Emirates", Emirates: "United Arab Emirates",
  "Czechia": "Czech Republic", "Democratic Republic of Congo": "DR Congo", "Democratic Republic of the Congo": "DR Congo", Congo: "DR Congo",
  "Korea": "South Korea", Türkiye: "Turkey", Burma: "Myanmar", Holland: "Netherlands",
};
const NAMES: [string, string][] = [...PLACES.map((p) => [p.name, p.name] as [string, string]), ...Object.entries(ALIASES)].sort((a, b) => b[0].length - a[0].length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RES = NAMES.map(([n, canon]) => ({ re: new RegExp(`(?<![A-Za-z])${esc(n)}(?![A-Za-z])`, "g"), canon }));
export const placeByName = (n: string) => PLACES.find((p) => p.name === n);

/** Countries mentioned in text (case-sensitive, longest name first so "Papua New Guinea" is not read as "Guinea"). */
export function mentionedCountries(text: string): string[] {
  let t = text;
  const found: string[] = [];
  for (const { re, canon } of RES) {
    if (re.test(t)) {
      if (!found.includes(canon)) found.push(canon);
      t = t.replace(re, " ");
    }
    re.lastIndex = 0;
  }
  return found;
}

export type Location = { country: string; region: string; lat: number; lon: number; basis: "mentioned in the retrieved text" | "publisher location only"; };

/** Where a development is. "mentioned" = named in headline/snippets. Otherwise the publisher's country, clearly labelled. */
export function locate(headline: string, sources: EvSource[]): Location[] {
  const text = [headline, ...sources.map((s) => s.title), ...sources.map((s) => s.summary ?? "")].join(" . ");
  const out: Location[] = [];
  for (const c of mentionedCountries(text)) {
    const p = placeByName(c);
    if (p) out.push({ country: p.name, region: p.region, lat: p.lat, lon: p.lon, basis: "mentioned in the retrieved text" });
  }
  if (out.length) return out.slice(0, 4);
  const pubs = new Set<string>();
  for (const s of sources) {
    const c = mentionedCountries(s.outletCountry ?? "")[0];
    if (c) pubs.add(c);
  }
  return [...pubs].slice(0, 2).map((c) => {
    const p = placeByName(c)!;
    return { country: p.name, region: p.region, lat: p.lat, lon: p.lon, basis: "publisher location only" as const };
  });
}

export const distanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
