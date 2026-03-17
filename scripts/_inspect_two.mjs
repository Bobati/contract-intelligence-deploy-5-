import fs from "node:fs";
import vm from "node:vm";
const src = fs.readFileSync("src/IssueAnalyzer.jsx", "utf8");
const marker = "let CLAUSE_FULLTEXT = ";
const s = src.indexOf(marker);
const b = src.indexOf("{", s);
let i = b;
let depth = 0;
let inStr = false;
let quote = "";
let esc = false;
for (; i < src.length; i++) {
  const ch = src[i];
  if (inStr) {
    if (esc) esc = false;
    else if (ch === "\\") esc = true;
    else if (ch === quote) { inStr = false; quote = ""; }
    continue;
  }
  if (ch === '"' || ch === "'" || ch === "`") { inStr = true; quote = ch; continue; }
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) break; }
}
const obj = vm.runInNewContext("(" + src.slice(b, i + 1) + ")");
for (const id of ["SAA-2.10", "SAA-10.4"]) {
  const v = obj[id] || {};
  const o = (v.text || "").replace(/\s+/g, "");
  const t = (v.translation || "").replace(/\s+/g, "");
  console.log("---", id, "ol", o.length, "tl", t.length, "ratio", o.length ? (t.length / o.length).toFixed(2) : "n/a");
  console.log("EN:", v.text || "");
  console.log("KO:", v.translation || "");
}
