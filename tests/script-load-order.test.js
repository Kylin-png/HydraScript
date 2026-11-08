// Load-order regression (Nov 7, 2026): script.js runs its panel init
// calls at the top level, mid-file, before the rest of the file has
// executed. A `let`/`const` binding declared AFTER one of those calls
// is still in its temporal dead zone when the init function assigns
// it, so the assignment throws a ReferenceError that aborts the rest
// of script.js — the editor loads half-wired (the Create panel never
// shows, the smoke test's F2 step fails on a hidden button) and every
// later call into the same binding throws again. The Nov 7 case was
// `let outlinerCollapsed` (declared after the initOutliner() call).
// This test statically proves, for every top-level init call in
// script.js, that nothing its body assigns at load time is a
// `let`/`const` declared after the call site.
//
// Method: a small scanner blanks strings, comments, and regex
// literals (keeping line numbers), then the checks run on the blanked
// source. Assignments inside nested functions are skipped — they run
// at event time, not at load time — and identifiers the body declares
// itself (locals, parameters) are not top-level bindings.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

// ---- blank strings, comments, regex literals (newlines preserved) ----
function blanked(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const isIdent = c => /[A-Za-z0-9_$]/.test(c);
  // The significant token before position i, for regex-vs-division.
  function prevToken() {
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return '';
    if (isIdent(src[j])) {
      let k = j;
      while (k >= 0 && isIdent(src[k])) k--;
      return src.slice(k + 1, j + 1);
    }
    return src[j];
  }
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
    } else if (c === '/' && src[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out[i] = ' '; i++;
      // Template literals nest code in ${ ... }; the braces inside
      // are balanced by construction, so blanking the whole literal
      // keeps the brace count right.
      while (i < n) {
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          // Skip the ${ } span as code, but blank it too: it is
          // balanced, so the depth counter is unaffected either way.
          let d = 0;
          while (i < n) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') { d--; if (d === 0) { if (src[i] !== '\n') out[i] = ' '; i++; break; } }
            if (src[i] !== '\n') out[i] = ' ';
            i++;
          }
          continue;
        }
        if (src[i] === '\\') { if (src[i] !== '\n') out[i] = ' '; i++; if (i < n && src[i] !== '\n') out[i] = ' '; i++; continue; }
        if (src[i] === q) { out[i] = ' '; i++; break; }
        if (src[i] === '\n' && q !== '`') break; // unterminated line string
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
    } else if (c === '/') {
      const prev = prevToken();
      const regexStart = prev === '' || '=:({[,!&|?:;'.includes(prev) ||
        ['return', 'typeof', 'case', 'delete', 'void', 'in', 'of', 'new', 'yield', 'await'].includes(prev);
      if (regexStart) {
        out[i] = ' '; i++;
        let inClass = false;
        while (i < n) {
          if (src[i] === '\\') { if (src[i] !== '\n') out[i] = ' '; i++; if (i < n && src[i] !== '\n') out[i] = ' '; i++; continue; }
          if (src[i] === '[') inClass = true;
          if (src[i] === ']') inClass = false;
          if (src[i] === '/' && !inClass) { out[i] = ' '; i++; break; }
          if (src[i] === '\n') break;
          if (src[i] !== '\n') out[i] = ' ';
          i++;
        }
        // Regex flags (g, i, m, s, u, y) follow the closing slash.
        while (i < n && /[a-z]/i.test(src[i])) { out[i] = ' '; i++; }
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return out.join('');
}

const BLANK = blanked(SRC);
const BLANK_LINES = BLANK.split('\n');
const RAW_LINES = SRC.split('\n');
function lineNo(idx) { return BLANK.slice(0, idx).split('\n').length; }

// Brace depth at the start of each line (blanked source: no braces
// hide in strings, comments, or regex literals).
const depthAtLineStart = [];
{
  let depth = 0;
  for (let ln = 0; ln < BLANK_LINES.length; ln++) {
    depthAtLineStart[ln] = depth;
    for (const ch of BLANK_LINES[ln]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
}

// ---- top-level let/const bindings (name -> declaration line) ----
const bindings = new Map(); // name -> line
{
  for (let ln = 0; ln < BLANK_LINES.length; ln++) {
    if (depthAtLineStart[ln] !== 0) continue;
    const line = BLANK_LINES[ln];
    const m = /^\s*(let|const)\s+(.*)$/.exec(line);
    if (!m) continue;
    // Split the declaration list on top-level commas; each segment
    // starts with the bound name (an initializer may follow).
    const rest = m[2];
    let segStart = 0, d = 0;
    const segments = [];
    for (let k = 0; k <= rest.length; k++) {
      const ch = rest[k];
      if (ch === '{' || ch === '[' || ch === '(') d++;
      else if (ch === '}' || ch === ']' || ch === ')') d--;
      else if ((ch === ',' && d === 0) || k === rest.length) {
        segments.push(rest.slice(segStart, k));
        segStart = k + 1;
      }
    }
    for (const seg of segments) {
      const nm = /^[A-Za-z_$][\w$]*/.exec(seg.trim());
      if (nm && !bindings.has(nm[0])) bindings.set(nm[0], ln + 1);
    }
  }
}
check('top-level let/const bindings found (sanity)', bindings.size > 50,
  `found ${bindings.size}`);
check('outlinerCollapsed is a top-level let binding', bindings.has('outlinerCollapsed'));

// ---- top-level call sites: if (typeof F === 'function') F(); and F(); ----
// Matched against the RAW lines (blanking erases the 'function'
// string literal the typeof pattern needs), and only at brace
// depth 0 — an identical-looking call inside a handler or a
// DOMContentLoaded callback runs after the whole file has executed,
// so it cannot hit a dead zone.
const callSites = []; // { fn, line }
for (let ln = 0; ln < RAW_LINES.length; ln++) {
  if (depthAtLineStart[ln] !== 0) continue;
  const line = RAW_LINES[ln];
  let m = /^\s*if \(typeof ([A-Za-z_$][\w$]*) === 'function'\) \1\(\);/.exec(line);
  if (m) { callSites.push({ fn: m[1], line: ln + 1 }); continue; }
  m = /^\s*([A-Za-z_$][\w$]*)\(\);/.exec(line);
  if (m) callSites.push({ fn: m[1], line: ln + 1 });
}
check('top-level init call sites found (sanity)', callSites.length >= 20,
  `found ${callSites.length}: ${callSites.map(c => c.fn).join(', ')}`);

// ---- function bodies (brace-matched on the blanked source) ----
function functionBody(name) {
  const re = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
  const m = re.exec(BLANK);
  if (!m) return null;
  const open = BLANK.indexOf('{', m.index + m[0].length);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < BLANK.length; i++) {
    if (BLANK[i] === '{') depth++;
    else if (BLANK[i] === '}') {
      depth--;
      if (depth === 0) return { start: open, end: i, line: lineNo(open) };
    }
  }
  return null;
}

// Skip a nested function body starting at index i (which points at
// the `function` keyword or at `=>`); returns the index just past it.
function skipNestedFunction(body, i) {
  // `function` keyword: skip to the end of its braced body.
  if (body.startsWith('function', i) && !/[A-Za-z0-9_$]/.test(body[i + 8] || '')) {
    const open = body.indexOf('{', i);
    if (open === -1) return body.length;
    let depth = 0;
    for (let j = open; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') { depth--; if (depth === 0) return j + 1; }
    }
    return body.length;
  }
  // Arrow: `=> { ... }` skips the braced body; `=> expr` skips to the
  // next semicolon at the current depth (the expression cannot assign
  // a top-level binding at load time from inside a callback).
  if (body.startsWith('=>', i)) {
    let j = i + 2;
    while (j < body.length && /\s/.test(body[j])) j++;
    if (body[j] === '{') {
      let depth = 0;
      for (let k = j; k < body.length; k++) {
        if (body[k] === '{') depth++;
        else if (body[k] === '}') { depth--; if (depth === 0) return k + 1; }
      }
      return body.length;
    }
    let depth = 0;
    while (j < body.length) {
      const ch = body[j];
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') { if (depth === 0) return j; depth--; }
      else if (ch === ';' && depth === 0) return j + 1;
      else if (ch === '\n' && depth === 0) return j;
      j++;
    }
    return body.length;
  }
  return i + 1;
}

// Bare assignments in a function body that run at load time:
// IDENT = / += / -= / *= / /= / %= / ++ / --, excluding property
// writes (obj.IDENT), declarations, and anything inside a nested
// function. Returns [{ name, line }] with line numbers in the file.
function loadTimeAssignments(fnName) {
  const fb = functionBody(fnName);
  if (!fb) return [];
  const body = BLANK.slice(fb.start + 1, fb.end);
  const baseLine = fb.line;
  // Identifiers the body declares itself: locals and parameters do
  // not touch top-level bindings even when the names collide.
  const shadowed = new Set();
  const paramMatch = /function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/.exec(BLANK.slice(Math.max(0, fb.start - 200), fb.start + 1));
  if (paramMatch) {
    for (const p of paramMatch[1].split(',')) {
      const nm = /^[A-Za-z_$][\w$]*/.exec(p.trim());
      if (nm) shadowed.add(nm[0]);
    }
  }
  for (const dm of body.matchAll(/(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g)) shadowed.add(dm[1]);
  const out = [];
  const assignRe = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*(\+\+|--|\+=|-=|\*=|\/=|%=|=(?!=|>))/g;
  let i = 0;
  while (i < body.length) {
    // Skip nested functions wholesale.
    if ((body.startsWith('function', i) && !/[A-Za-z0-9_$]/.test(body[i + 8] || '')) || body.startsWith('=>', i)) {
      i = skipNestedFunction(body, i);
      continue;
    }
    assignRe.lastIndex = i;
    const m = assignRe.exec(body);
    if (!m) break;
    const name = m[2];
    if (!shadowed.has(name) && !['let', 'const', 'var', 'function', 'return', 'typeof', 'new', 'if', 'for', 'while', 'switch', 'case', 'delete', 'void', 'in', 'of'].includes(name)) {
      out.push({ name, line: baseLine + body.slice(0, m.index).split('\n').length - 1 });
    }
    i = m.index + m[0].length;
  }
  return out;
}

// ---- the check: no load-time assignment hits a later-declared let/const ----
const lateHits = [];
for (const site of callSites) {
  for (const a of loadTimeAssignments(site.fn)) {
    const declLine = bindings.get(a.name);
    if (declLine !== undefined && declLine > site.line) {
      lateHits.push(`${a.name} (assigned in ${site.fn}, called line ${site.line}, declared line ${declLine})`);
    }
  }
}
check('no load-time init assigns a let/const declared after its call site',
  lateHits.length === 0, lateHits.join('; '));

// ---- the pinned Nov 7 case ----
const outlinerDecl = bindings.get('outlinerCollapsed');
const outlinerCall = callSites.find(c => c.fn === 'initOutliner');
check('outlinerCollapsed is declared before the initOutliner() call site',
  outlinerDecl !== undefined && outlinerCall !== undefined && outlinerDecl < outlinerCall.line,
  `declared line ${outlinerDecl}, called line ${outlinerCall ? outlinerCall.line : '?'}`);

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all script load-order checks passed');
