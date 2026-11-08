/**
 * WorldFiled verification-source directory.
 *
 * These are high-value starting points whose institutional identity or editorial
 * standards were checked on 2026-11-08. They are NOT claim-level verification results.
 * Use the original document or dataset relevant to the claim, confirm its date/version,
 * and independently check disputed or consequential claims.
 */
export type VerificationSourceStarter = {
  region: "United Kingdom" | "United States" | "Canada" | "Nigeria" | "Global";
  name: string;
  url: string;
  purpose: string;
  class: "official_record" | "official_statistics" | "institutional_data" | "independent_reporting";
  standardsUrl?: string;
};

export const VERIFICATION_SOURCE_DIRECTORY_REVIEWED_ON = "2026-11-08";

export const VERIFICATION_SOURCE_STARTERS: VerificationSourceStarter[] = [
  // United Kingdom
  { region: "United Kingdom", name: "Legislation.gov.uk", url: "https://www.legislation.gov.uk", purpose: "Current and historic UK legislation; check commencement, amendments and jurisdiction.", class: "official_record" },
  { region: "United Kingdom", name: "UK Parliament", url: "https://www.parliament.uk", purpose: "Bills, debates, committee evidence, votes and parliamentary documents.", class: "official_record" },
  { region: "United Kingdom", name: "Office for National Statistics", url: "https://www.ons.gov.uk", purpose: "Official UK population, labour, price, economic and social statistics; inspect methodology and reference period.", class: "official_statistics" },
  { region: "United Kingdom", name: "Bank of England", url: "https://www.bankofengland.co.uk", purpose: "Monetary policy decisions, financial stability publications and central-bank data.", class: "institutional_data" },

  // United States
  { region: "United States", name: "Congress.gov", url: "https://www.congress.gov", purpose: "Federal bills, resolutions, legislative actions and congressional records.", class: "official_record" },
  { region: "United States", name: "Federal Register", url: "https://www.federalregister.gov", purpose: "Federal rules, proposed rules, notices and agency documents; distinguish proposal from final rule.", class: "official_record" },
  { region: "United States", name: "U.S. Census Bureau", url: "https://www.census.gov/data.html", purpose: "Official population, demographic, economic and geographic datasets.", class: "official_statistics" },
  { region: "United States", name: "U.S. Bureau of Labor Statistics", url: "https://www.bls.gov", purpose: "Employment, inflation, wages, prices and productivity data; inspect seasonal adjustment and revisions.", class: "official_statistics" },
  { region: "United States", name: "SEC EDGAR", url: "https://www.sec.gov/edgar/search/", purpose: "Company filings, registration statements, ownership disclosures and regulator documents.", class: "official_record" },
  { region: "United States", name: "Federal Reserve", url: "https://www.federalreserve.gov", purpose: "Federal Reserve decisions, statements, minutes and economic data.", class: "institutional_data" },

  // Canada
  { region: "Canada", name: "Justice Laws Website", url: "https://laws-lois.justice.gc.ca/eng/", purpose: "Official consolidations of federal Acts and regulations; check current-to date and original amending instruments.", class: "official_record" },
  { region: "Canada", name: "Statistics Canada", url: "https://www.statcan.gc.ca/en/start", purpose: "National statistical office datasets, methods, releases and key indicators.", class: "official_statistics" },
  { region: "Canada", name: "Parliament of Canada", url: "https://www.parl.ca", purpose: "Federal bills, legislative proceedings, committee records and parliamentary documents.", class: "official_record" },
  { region: "Canada", name: "Bank of Canada", url: "https://www.bankofcanada.ca", purpose: "Monetary policy, financial-system publications and central-bank statistics.", class: "institutional_data" },
  { region: "Canada", name: "Canada Gazette", url: "https://gazette.gc.ca", purpose: "Official publication of federal regulations, proposed regulations and statutory notices.", class: "official_record" },

  // Nigeria
  { region: "Nigeria", name: "National Assembly of Nigeria", url: "https://nass.gov.ng", purpose: "Bills, Acts, legislative proceedings, committee documents and parliamentary records.", class: "official_record" },
  { region: "Nigeria", name: "Central Bank of Nigeria", url: "https://www.cbn.gov.ng", purpose: "Monetary Policy Committee decisions, financial statistics, circulars and central-bank publications.", class: "institutional_data" },
  { region: "Nigeria", name: "National Bureau of Statistics", url: "https://www.nigerianstat.gov.ng", purpose: "National statistics, survey releases, price indices and methodology.", class: "official_statistics" },
  { region: "Nigeria", name: "Federal Ministry of Finance", url: "https://finance.gov.ng", purpose: "Budget documents, appropriation materials, fiscal strategy and implementation publications.", class: "official_record" },
  { region: "Nigeria", name: "Federal Ministry of Budget and Economic Planning", url: "https://nationalplanning.gov.ng", purpose: "National development plans, policy documents and budget-office materials.", class: "official_record" },

  // Global
  { region: "Global", name: "UN Official Document System", url: "https://documents.un.org", purpose: "UN resolutions, reports, meeting records and official documents; distinguish member-state positions from UN findings.", class: "official_record" },
  { region: "Global", name: "UN Data", url: "https://data.un.org", purpose: "Statistical tables and source references from UN and partner agencies.", class: "institutional_data" },
  { region: "Global", name: "World Health Organization", url: "https://www.who.int", purpose: "Official health guidance, technical reports, disease data and emergency updates.", class: "institutional_data" },
  { region: "Global", name: "International Monetary Fund", url: "https://www.imf.org/en/Data", purpose: "IMF economic datasets, country reports and methodology; identify estimates and projections.", class: "institutional_data" },
  { region: "Global", name: "World Bank Open Data", url: "https://data.worldbank.org", purpose: "Development indicators, data definitions, country series and update schedules.", class: "institutional_data" },
  { region: "Global", name: "World Meteorological Organization", url: "https://wmo.int", purpose: "Authoritative meteorological and climate information, assessments and data coordination.", class: "institutional_data" },
  { region: "Global", name: "FAOSTAT", url: "https://www.fao.org/faostat/en/#home", purpose: "Food, agriculture, land use and related statistical data with definitions and periods.", class: "institutional_data" },
  { region: "Global", name: "International Atomic Energy Agency", url: "https://www.iaea.org", purpose: "Nuclear safety, safeguards, inspection and technical publications; attribute institutional assessments precisely.", class: "institutional_data" },

  // Accountable international reporting organisations. Their reporting is evidence to examine,
  // not a substitute for the original record or claim-by-claim corroboration.
  { region: "Global", name: "Reuters", url: "https://www.reuters.com", purpose: "International independent reporting; trace wire copy, original reporting and syndication before counting corroboration.", class: "independent_reporting", standardsUrl: "https://reutersagency.com/about/standards-values/" },
  { region: "Global", name: "Associated Press", url: "https://apnews.com", purpose: "International and US reporting; identify original sources and check the underlying document where available.", class: "independent_reporting", standardsUrl: "https://www.ap.org/about/news-values-and-principles/" },
  { region: "Global", name: "Agence France-Presse", url: "https://www.afp.com", purpose: "International wire reporting; identify upstream wire origin and independently sourced details.", class: "independent_reporting", standardsUrl: "https://www.afp.com/en/afp-charters" },
];

export function verificationStartersFor(regions: string[] = []): VerificationSourceStarter[] {
  const normalized = ` ${regions.join(" ").toLowerCase().replace(/[^a-z0-9.]+/g, " ")} `;
  const matches = (pattern: RegExp) => pattern.test(normalized);
  const wanted = new Set<VerificationSourceStarter["region"]>(["Global"]);
  if (matches(/\b(united kingdom|uk|britain|england|scotland|wales)\\b/)) wanted.add("United Kingdom");
  if (matches(/\b(united states|usa|u.s|america)\\b/)) wanted.add("United States");
  if (matches(/\bcanada\\b/)) wanted.add("Canada");
  if (matches(/\bnigeria\\b/)) wanted.add("Nigeria");
  // If no jurisdiction is discoverable, retain the global primary and wire-service starters.
  return VERIFICATION_SOURCE_STARTERS.filter((s) => wanted.has(s.region));
}
