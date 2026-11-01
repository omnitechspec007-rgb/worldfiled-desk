import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BRAND, BRAND_VERSION, brandBlock, brandChecklist } from "../netlify/lib/brand.mts";

let pass = 0, fail = 0;
const check = (name: string, v: boolean) => { console.log((v ? "PASS " : "FAIL ") + name); v ? pass++ : fail++; };

// Official logo is byte-identical to the file supplied by the user (hash recorded when it was received).
const OFFICIAL_SHA256 = "5a2e1d252029d15e9064b4b066be457c2f1f07825e85cc4e173dd1577f3b4ac1";
const svg = readFileSync("public/brand/TWF_final_logo.svg");
check("logo SVG is byte-identical to the supplied file (sha256)", createHash("sha256").update(svg).digest("hex") === OFFICIAL_SHA256);
check("logo SVG is unchanged: still contains its own original colours", svg.includes("#FCC83D") && svg.includes("#07223E"));
check("logo SVG does not carry the descriptor line", !/LAWS|DISCOVERIES/i.test(svg.toString()));
check("logo is served from the public folder path the app links to", BRAND.logoPublicPath === "/brand/TWF_final_logo.svg");

const b = brandBlock();
check("name and tagline exact", b.includes("THE WORLD, FILED.") && b.includes('"What happened. What changed. What matters."'));
for (const hex of ["#0B1F38", "#F7F4ED", "#FFC857", "#4CC9B0"]) check("palette hex " + hex, b.includes(hex));
check("brand version stamped", b.includes(BRAND_VERSION));
check("descriptor is forbidden, not added", b.includes("Do not add the descriptor") );
check("logo rule: no recolour/crop/recreate", /Do not redesign, distort, recolour, crop, stretch or recreate/.test(b));
check("logo rule: ask for file, labelled placeholder, no invention", /ask the user to attach/.test(b) && /LOGO PLACEHOLDER/.test(b) && /do NOT invent/.test(b));
check("applies throughout, not just first/last frame", /throughout the whole production/.test(b));
check("voice, typography, mobile and adaptation sections present", ["Brand voice","Typography and hierarchy","Mobile readability","Story-specific visual adaptation","Prohibited treatments"].every((s) => b.includes(s)));
check("brand compliance checklist exists and is separate from facts", brandChecklist().length >= 8 && brandChecklist().some((c) => /checked separately/.test(c)));

// App stylesheet uses exactly the approved palette tokens.
const css = readFileSync("src/styles.css", "utf8").toLowerCase();
for (const hex of ["#0b1f38", "#f7f4ed", "#ffc857", "#4cc9b0"]) check("stylesheet defines " + hex, css.includes(hex));
check("stylesheet does not use the logo's off-palette navy #07223e", !css.includes("#07223e"));

console.log(`\n${fail ? "FAILURES: " + fail : "ALL " + pass + " BRAND CHECKS PASSED"}`);
process.exit(fail ? 1 : 0);
