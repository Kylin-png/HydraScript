// Unit tests for hydra/hydra-tags.js — the shared object tags system
// (P4 Advanced batch 34: object tags / groups, beginner edition).
//
// Pure logic: the tag lists (trim, dedupe case-insensitively, cap at
// 16), the add / remove / clear writes, the has / count reads, and the
// routing sets. Nothing here touches the DOM; both runtimes delegate
// to this module. Static checks at the end pin the wiring: catalog
// blocks, both runtimes' dispatch and the Has Tag / Tagged Count
// conditions, the normalizer repair, the Inspector Tags section, and
// the docs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');
const REPO = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-tags.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-tags.js'), 'utf8'),
  sandbox, { filename: 'hydra-tags.js' });
const T = sandbox.HydraTags;

check('HydraTags exposed with helpers',
  !!T && typeof T.normalizeTag === 'function' &&
  typeof T.tagEquals === 'function' &&
  typeof T.normalizeTags === 'function' &&
  typeof T.normalizeTagsOn === 'function' &&
  typeof T.tagsOf === 'function' &&
  typeof T.hasTag === 'function' &&
  typeof T.addTag === 'function' &&
  typeof T.removeTag === 'function' &&
  typeof T.clearTags === 'function' &&
  typeof T.objectsWithTag === 'function' &&
  typeof T.countTagged === 'function' &&
  typeof T.isTagAction === 'function' &&
  typeof T.isTagCondition === 'function');
check('factorySource is a non-empty string',
  typeof T.factorySource === 'string' && T.factorySource.length > 100 &&
  T.factorySource.includes('hydraTagsFactory'));
check('caps are 16 tags per object and 64 characters per tag',
  T.MAX_TAGS_PER_OBJECT === 16 && T.MAX_TAG_LENGTH === 64);

// --- normalizers ---
check('normalizeTag trims, drops blanks and non-strings, and cuts at 64 characters',
  T.normalizeTag('  Goblin ') === 'Goblin' &&
  T.normalizeTag('goblin') === 'goblin' &&
  T.normalizeTag('') === '' && T.normalizeTag('   ') === '' &&
  T.normalizeTag(null) === '' && T.normalizeTag(42) === '' &&
  T.normalizeTag(['goblin']) === '' &&
  T.normalizeTag('x'.repeat(100)) === 'x'.repeat(64));
check('tagEquals ignores case and space, and a blank tag never equals anything',
  T.tagEquals('Goblin', 'goblin') === true &&
  T.tagEquals(' goblin ', 'GOBLIN') === true &&
  T.tagEquals('goblin', 'coin') === false &&
  T.tagEquals('', '') === false && T.tagEquals('goblin', '') === false &&
  T.tagEquals(null, 'goblin') === false);
check('normalizeTags dedupes case-insensitively (first spelling wins), drops blanks, caps at 16',
  JSON.stringify(T.normalizeTags(['goblin', 'Goblin', ' coin ', '', null, 7, 'boss'])) ===
    JSON.stringify(['goblin', 'coin', 'boss']) &&
  T.normalizeTags(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9',
    't10', 't11', 't12', 't13', 't14', 't15', 't16', 't17']).length === 16 &&
  T.normalizeTags('goblin').length === 0 && T.normalizeTags(null).length === 0);
check('normalizeTags never mutates its input',
  (() => {
    const input = ['goblin', 'Goblin', 'coin'];
    T.normalizeTags(input);
    return JSON.stringify(input) === JSON.stringify(['goblin', 'Goblin', 'coin']);
  })());
check('normalizeTagsOn repairs an object in place and leaves a non-object alone',
  (() => {
    const obj = { name: 'g', tags: ['goblin', 'Goblin', '', 'coin'] };
    T.normalizeTagsOn(obj);
    return JSON.stringify(obj.tags) === JSON.stringify(['goblin', 'coin']) &&
      T.normalizeTagsOn(null) === null && T.normalizeTagsOn('nope') === 'nope';
  })());
check('tagsOf returns a fresh copy (mutating it never touches the live record)',
  (() => {
    const obj = { tags: ['goblin', 'coin'] };
    const copy = T.tagsOf(obj);
    copy.push('boss');
    return JSON.stringify(copy) === JSON.stringify(['goblin', 'coin', 'boss']) &&
      JSON.stringify(obj.tags) === JSON.stringify(['goblin', 'coin']) &&
      T.tagsOf(null).length === 0 && T.tagsOf({}).length === 0;
  })());

// --- reads ---
check('hasTag is true while the object carries the tag, any case, and false otherwise',
  T.hasTag({ tags: ['goblin', 'elite'] }, 'GOBLIN') === true &&
  T.hasTag({ tags: ['goblin'] }, 'coin') === false &&
  T.hasTag({ tags: ['goblin'] }, '') === false &&
  T.hasTag({ tags: ['goblin'] }, null) === false &&
  T.hasTag(null, 'goblin') === false &&
  T.hasTag({}, 'goblin') === false &&
  T.hasTag({ tags: 'goblin' }, 'goblin') === false);
check('objectsWithTag returns the tagged objects in list order, and none for a blank tag',
  (() => {
    const a = { name: 'a', tags: ['goblin'] };
    const b = { name: 'b', tags: ['coin'] };
    const c = { name: 'c', tags: ['Goblin', 'elite'] };
    return JSON.stringify(T.objectsWithTag([a, b, c], 'goblin').map(o => o.name)) ===
      JSON.stringify(['a', 'c']) &&
      T.objectsWithTag([a, b, c], '').length === 0 &&
      T.objectsWithTag(null, 'goblin').length === 0 &&
      T.objectsWithTag([a, null, 'nope'], 'goblin').length === 1;
  })());
check('countTagged counts the tagged objects',
  T.countTagged([{ tags: ['goblin'] }, { tags: ['coin'] }, { tags: ['Goblin'] }], 'goblin') === 2 &&
  T.countTagged([{ tags: ['goblin'] }], 'coin') === 0 &&
  T.countTagged([], 'goblin') === 0 &&
  T.countTagged(null, 'goblin') === 0);

// --- writes ---
{
  const obj = { name: 'g', tags: [] };
  check('addTag sticks a tag on and returns true',
    T.addTag(obj, 'goblin') === true && JSON.stringify(obj.tags) === JSON.stringify(['goblin']));
  check('addTag trims the tag it adds',
    T.addTag(obj, '  elite ') === true && obj.tags[1] === 'elite');
  check('addTag refuses a duplicate in another case and keeps the first spelling',
    T.addTag(obj, 'GOBLIN') === false && JSON.stringify(obj.tags) === JSON.stringify(['goblin', 'elite']));
  check('addTag refuses a blank tag and a non-object',
    T.addTag(obj, '') === false && T.addTag(obj, '   ') === false &&
    T.addTag(null, 'goblin') === false && T.addTag(obj, 42) === false);
  check('removeTag takes a tag off in any case and returns true',
    T.removeTag(obj, 'ELITE') === true && JSON.stringify(obj.tags) === JSON.stringify(['goblin']));
  check('removeTag stays quiet when the tag was never there',
    T.removeTag(obj, 'coin') === false && JSON.stringify(obj.tags) === JSON.stringify(['goblin']));
  check('clearTags takes every tag off',
    T.addTag(obj, 'boss') === true &&
    T.clearTags(obj) === true && obj.tags.length === 0);
  check('clearTags stays quiet on a non-object',
    T.clearTags(null) === false && T.clearTags('nope') === false);
}
check('addTag stops at 16 tags',
  (() => {
    const obj = { tags: [] };
    for (let i = 0; i < 16; i++) T.addTag(obj, 't' + i);
    return obj.tags.length === 16 && T.addTag(obj, 'one-more') === false &&
      obj.tags.length === 16;
  })());

// --- routing ---
check('routing sets cover the four tag actions and the two tag conditions',
  T.isTagAction('addTag') && T.isTagAction('removeTag') &&
  T.isTagAction('clearTags') && T.isTagAction('readTaggedCount') &&
  !T.isTagAction('damageObject') && !T.isTagAction('startBoss') &&
  !T.isTagAction(null) &&
  T.isTagCondition('hasTag') && T.isTagCondition('taggedCount') &&
  !T.isTagCondition('bossActive') && !T.isTagCondition('healthCheck') &&
  !T.isTagCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  T.normalizeTag({}) === '' &&
  T.tagEquals([], []) === false &&
  T.normalizeTags({ length: 2, 0: 'a', 1: 'b' }).length === 0 &&
  T.hasTag({ tags: [[]] }, 'goblin') === false &&
  T.addTag({ tags: 'goblin' }, 'coin') === true &&
  T.removeTag({ tags: null }, 'goblin') === false &&
  T.countTagged('nope', 'goblin') === 0);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const tagsTag = html.indexOf('src="hydra-tags.js');
  check('index.html loads hydra-tags.js before player-runtime.js and script.js',
    tagsTag !== -1 && tagsTag < html.indexOf('src="player-runtime.js') && tagsTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-tags.js after hydra-boss.js',
    tagsTag > html.indexOf('src="hydra-boss.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraTags',
    playerJs.includes("if (!HydraTags || typeof HydraTags.normalizeTags !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-tags.js'));
  check('player-runtime.js inlines HydraTags into exports',
    playerJs.includes("'HydraTags', global.HydraTags && global.HydraTags.factorySource"));
  check('player-runtime.js classifies tag blocks for the dispatch',
    playerJs.includes('HydraTags.isTagAction(type)') &&
    playerJs.includes('HydraTags.isTagCondition(type)'));
  check('player-runtime.js exposes the tags module to both contexts (no per-run tags state)',
    playerJs.includes('tagsModule: HydraTags') &&
    !playerJs.includes('createTagsState'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the tags module to both contexts',
    previewJs.includes("tagsModule: mod('Tags')"));
  check('preview runtime holds no per-run tags state (tags live on the objects)',
    !previewJs.includes('tagsRuntime'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the four tag actions',
    executeJs.includes("if (isType(ctx.tagsModule, 'isTagAction', type))") &&
    executeJs.includes("type === 'addTag'") &&
    executeJs.includes("type === 'removeTag'") &&
    executeJs.includes("type === 'clearTags'") &&
    executeJs.includes("type === 'readTaggedCount'") &&
    executeJs.includes('TG.addTag(o, tgTag)') &&
    executeJs.includes('TG.removeTag(o, tgTag)') &&
    executeJs.includes('TG.clearTags(o)') &&
    executeJs.includes('TG.countTagged(allObjects(ctx), rtcTag)'));
  const condJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module evaluates the Has Tag and Tagged Count conditions',
    condJs.includes("case 'hasTag':") &&
    condJs.includes("case 'taggedCount':") &&
    condJs.includes('Tm.hasTag(htObjs[hti], data.tag)') &&
    condJs.includes('TcM.countTagged(allObjects(ctx), data.tag)'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module defaults Has Tag and Tagged Count to the level trigger',
    flowJs.includes("t === 'hasTag'") && flowJs.includes("t === 'taggedCount'"));
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  check('universal normalizer repairs tag lists through the tags module',
    universalJs.includes('window.HydraTags.normalizeTagsOn(obj)') &&
    universalJs.includes("obj.tags = Array.isArray(obj.tags) ? obj.tags : []"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor Inspector carries a Tags section (chips + add box) under Health',
    scriptJs.includes('function appendTagsEditor(root, obj)') &&
    scriptJs.includes('appendTagsEditor(root, obj);') &&
    scriptJs.includes("section.className = 'tags-editor'") &&
    scriptJs.includes("chip.className = 'tag-chip'") &&
    scriptJs.includes("addBtn.textContent = 'Add tag'") &&
    scriptJs.includes('TG.normalizeTagsOn(obj)'));
  const css = fs.readFileSync(path.join(HYDRA, 'style.css'), 'utf8');
  check('stylesheet carries the tag-chip rules',
    css.includes('.tag-chip {') && css.includes('.tag-chip-x') &&
    css.includes('.tags-add-row'));
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the six tag blocks in the Tags category',
    catalogJs.includes("blockType: 'add-tag'") &&
    catalogJs.includes("runtimeType: 'addTag'") &&
    catalogJs.includes("blockType: 'remove-tag'") &&
    catalogJs.includes("runtimeType: 'removeTag'") &&
    catalogJs.includes("blockType: 'clear-tags'") &&
    catalogJs.includes("runtimeType: 'clearTags'") &&
    catalogJs.includes("blockType: 'read-tagged-count'") &&
    catalogJs.includes("runtimeType: 'readTaggedCount'") &&
    catalogJs.includes("blockType: 'has-tag'") &&
    catalogJs.includes("runtimeType: 'hasTag'") &&
    catalogJs.includes("blockType: 'tagged-count'") &&
    catalogJs.includes("runtimeType: 'taggedCount'") &&
    catalogJs.includes("key: 'tag', label: 'Tag'") &&
    catalogJs.includes("key: 'varName', label: 'Into variable'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all ten tag blocks',
    refMd.includes('Add Tag') && refMd.includes('Remove Tag') &&
    refMd.includes('Clear Tags') && refMd.includes('Read Tagged Count') &&
    refMd.includes('Has Tag') && refMd.includes('Tagged Count') &&
    refMd.includes('Pick Nearest Tagged') && refMd.includes('Pick Farthest Tagged') &&
    refMd.includes('Pick Random Tagged') && refMd.includes('Pick Tagged Object Into Variable') &&
    refMd.includes('### Tags (10)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers object tags',
    guideMd.includes('Object tags') && guideMd.includes('Add Tag') &&
    guideMd.includes('Tagged Count') && guideMd.includes('Has Tag'));
}

process.exit(failures === 0 ? 0 : 1);
