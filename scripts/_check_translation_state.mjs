import fs from "node:fs";
import vm from "node:vm";
const src = fs.readFileSync("src/IssueAnalyzer.jsx","utf8");
const marker = "let CLAUSE_FULLTEXT = ";
const s = src.indexOf(marker);
const b = src.indexOf("{", s);
let i=b, d=0, ins=false, q="", esc=false;
for(; i<src.length; i++){
  const ch=src[i];
  if(ins){ if(esc){esc=false;} else if(ch==='\\'){esc=true;} else if(ch===q){ins=false;q='';} continue; }
  if(ch==='"'||ch==="'"||ch==='`'){ins=true;q=ch;continue;}
  if(ch==='{') d++; else if(ch==='}') {d--; if(d===0) break;}
}
const obj = vm.runInNewContext("("+src.slice(b,i+1)+")");
const hasEn = t => ((t||"").match(/[A-Za-z]/g)||[]).length>=40;
const likelySummary=(o,t)=>{ if(!hasEn(o)) return false; if(!t) return true; const ol=(o||"").replace(/\s+/g,"").length; const tl=(t||"").replace(/\s+/g,"").length; if(!ol) return false; return tl < Math.max(120, Math.floor(ol*0.45)); };
const targets = Object.entries(obj).filter(([_,v])=>["SAA","TOS","OF3","OF4"].includes(v?.doc)).filter(([_,v])=>hasEn(v?.text));
const remain = targets.filter(([_,v])=>likelySummary(v?.text,v?.translation));
console.log(`targets=${targets.length}, remaining_summary_like=${remain.length}`);
if(remain.length) console.log(remain.map(([id])=>id).join(","));
