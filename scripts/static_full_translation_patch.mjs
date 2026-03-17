import fs from 'node:fs/promises';
import vm from 'node:vm';

const filePath = 'src/IssueAnalyzer.jsx';

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function findObjectBounds(src, marker) {
  const startIdx = src.indexOf(marker);
  if (startIdx < 0) throw new Error('CLAUSE_FULLTEXT marker not found');
  const braceStart = src.indexOf('{', startIdx);
  if (braceStart < 0) throw new Error('Opening brace not found');

  let i = braceStart;
  let depth = 0;
  let inString = false;
  let quote = '';
  let escape = false;

  for (; i < src.length; i += 1) {
    const ch = src[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return { startIdx, braceStart, braceEnd: i };
      }
    }
  }
  throw new Error('Closing brace not found');
}

function hasEnglishBody(text) {
  if (!text) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters >= 40;
}

function isLikelySummaryTranslation(originalText, translationText) {
  if (!hasEnglishBody(originalText)) return false;
  if (!translationText) return true;
  const oLen = (originalText || '').replace(/\s+/g, '').length;
  const tLen = (translationText || '').replace(/\s+/g, '').length;
  if (!oLen) return false;
  return tLen < Math.max(120, Math.floor(oLen * 0.45));
}

async function translateFull(item) {
  const url = 'https://contract-intelligence-deploy-5-depl.vercel.app/api/chat';
  const prompt = [
    '다음 계약 조항을 한국어로 전문 완역하시오.',
    '요약 금지, 생략 금지, 항목/번호/단서를 모두 유지하시오.',
    '의미를 바꾸지 말고 원문 구조를 최대한 보존하시오.',
    '응답은 번역문 본문만 출력하고, 설명/주석/머리말을 붙이지 마시오.',
    '',
    `[조항 ID] ${item.section || ''}`,
    `[조항 제목] ${item.title || ''}`,
    '[원문]',
    item.text || '',
  ].join('\n');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const content = (data?.content || []).map((c) => c?.text || '').join('\n').trim();
  if (!content || !content.trim()) {
    throw new Error('Empty translation result');
  }
  return content;
}

const envText = await fs.readFile('.env.local', 'utf8');
parseEnv(envText);

const source = await fs.readFile(filePath, 'utf8');
const marker = 'let CLAUSE_FULLTEXT = ';
const { braceStart, braceEnd } = findObjectBounds(source, marker);
const objectLiteral = source.slice(braceStart, braceEnd + 1);
const parsed = vm.runInNewContext(`(${objectLiteral})`);

const targets = Object.entries(parsed)
  .filter(([_, v]) => ['SAA', 'TOS', 'OF3', 'OF4'].includes(v?.doc))
  .filter(([_, v]) => hasEnglishBody(v?.text))
  .filter(([_, v]) => isLikelySummaryTranslation(v?.text, v?.translation));

console.log(`Targets: ${targets.length}`);

let ok = 0;
let fail = 0;
for (const [id, clause] of targets) {
  try {
    const translated = await translateFull(clause);
    parsed[id].translation = translated;
    ok += 1;
    console.log(`[OK ${ok}/${targets.length}] ${id}`);
  } catch (e) {
    fail += 1;
    console.log(`[FAIL] ${id}: ${e.message}`);
  }
}

const serialized = JSON.stringify(parsed, null, 2)
  .replace(/\\u003c/g, '<')
  .replace(/\\u003e/g, '>')
  .replace(/\\u0026/g, '&');

const patched = source.slice(0, braceStart) + serialized + source.slice(braceEnd + 1);
await fs.writeFile(filePath, patched, 'utf8');

console.log(`Done. success=${ok}, fail=${fail}`);
