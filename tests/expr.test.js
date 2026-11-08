// Unit tests for hydra/hydra-expr.js — the shared expression evaluator.
// Loads the module in a vm sandbox (it is pure: no DOM required).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-expr.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox; // hydra-expr.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'hydra-expr.js' });
const HydraExpr = sandbox.HydraExpr;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const E = (expr, opts) => HydraExpr.evaluate(expr, opts || {});

// --- basics ---
eq('plain number', E('5').value, 5);
eq('plain number ok', E('5').ok, true);
eq('numeric input passthrough', E(7).value, 7);
eq('empty string -> 0 ok', E('').ok, true);
eq('null -> 0 ok', E(null).ok, true);
eq('variable lookup', E('score + 10', { variables: { score: 5 } }).value, 15);
eq('builtin lookup', E('mouseX * 2', { builtins: { mouseX: 21 } }).value, 42);

// --- object.prop resolution ---
const withPlayer = { lookupObject: (n) => (n === 'player' ? { posX: 21, name: 'player' } : null) };
eq('object.prop', E('player.posX * 2', withPlayer).value, 42);
eq('missing object -> 0', E('ghost.posX + 1', withPlayer).value, 1);
eq('missing prop -> 0', E('player.nope + 1', withPlayer).value, 1);

// --- THE FIX: Math.* expressions ---
eq('Math.floor', E('Math.floor(score / 10)', { variables: { score: 25 } }).value, 2);
eq('Math.floor ok', E('Math.floor(score / 10)', { variables: { score: 25 } }).ok, true);
eq('Math.PI', Math.abs(E('Math.PI * 2').value - Math.PI * 2) < 1e-9, true);
{
  const r = E('Math.floor(Math.random() * 690) + 40');
  check('Math.random composition ok', r.ok === true);
  check('Math.random composition range', r.value >= 40 && r.value < 730, `got ${r.value}`);
}
eq('Math.max mixed with vars', E('Math.max(score, 100)', { variables: { score: 37 } }).value, 100);
eq('Math not flagged unknown', E('Math.floor(2.7)').unknowns.length, 0);
// an object literally named Math still loses to the real Math (documented)
check('resolvePropAccess passes Math.* through untouched',
  HydraExpr.resolvePropAccess('Math.floor(x)', () => ({ x: 1 })) === 'Math.floor(x)');
check('resolvePropAccess still resolves normal objects',
  HydraExpr.resolvePropAccess('player.posX', (n) => (n === 'player' ? { posX: 9 } : null)) === '9');

// --- unknowns / failure modes ---
{
  let warned = '';
  const r = E('mystery + 1', { onWarning: (m) => { warned = m; } });
  eq('unknown identifier -> ok false', r.ok, false);
  eq('unknown identifier named', r.unknowns.join(','), 'mystery');
  check('unknown identifier warns', warned.includes('mystery'), warned);
}
{
  const r = E('score +', { variables: { score: 1 } });
  eq('syntax error -> ok false', r.ok, false);
  eq('syntax error -> value 0', r.value, 0);
}
eq('non-numeric result -> 0 not ok', E('"hello"').ok, false);
eq('string literal concat not numeric', E('"a" + "b"').ok, false);
eq('boolean true -> 1? (not a number result -> 0)', E('true').value, 0);

// --- unknownIdentifiers helper ---
check('unknownIdentifiers finds missing names',
  HydraExpr.unknownIdentifiers('a + b', { a: 1 }).join(',') === 'b');
check('unknownIdentifiers ignores strings',
  HydraExpr.unknownIdentifiers('"b" + a', { a: 1 }).length === 0);
check('unknownIdentifiers ignores Math',
  HydraExpr.unknownIdentifiers('Math.floor(a)', { a: 1 }).length === 0);

// --- factorySource (used by export inlining) ---
check('factorySource is a non-empty function source',
  typeof HydraExpr.factorySource === 'string' && HydraExpr.factorySource.includes('hydraExprFactory'));
{
  // the factory source must be self-contained: evaluate it standalone
  const s2 = {};
  s2.window = s2;
  vm.createContext(s2);
  vm.runInContext(`window.HydraExpr=(${HydraExpr.factorySource})();`, s2);
  eq('factorySource re-instantiates', s2.HydraExpr.evaluate('Math.floor(2.9)').value, 2);
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('expr.test.js: all assertions passed');
