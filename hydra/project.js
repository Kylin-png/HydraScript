// Project management — project.js (v3)
document.addEventListener('DOMContentLoaded', function () {
  const projectNameEl  = document.getElementById('project-name');
  const saveBtn        = document.getElementById('save-project-btn');
  const exportPlayableBtn = document.getElementById('export-playable-btn');
  const homeBtn        = document.getElementById('home-btn');

  let currentProject   = null;
  let currentProjectId = localStorage.getItem('currentProjectId');

  try {
    initProject();
  } catch (err) {
    // P1 item 16: a damaged saved project must never kill the editor at
    // load time. Fall back to a fresh project; the raw store was already
    // backed up by loadProjects(), and the rest of this handler (save,
    // export, import wiring) still runs below.
    console.error('Error starting project, opening a fresh project instead:', err);
    try { createNewProject(); } catch (err2) { console.error('Could not create a fresh project:', err2); }
  }
  saveBtn?.addEventListener('click', () => saveProject({ force: true }));
  exportPlayableBtn?.addEventListener('click', exportPlayableGame);
  homeBtn.addEventListener('click', returnToHome);
  // P3 item 15: project JSON import/export + new-project templates, from
  // inside the editor (the hub already had these; the editor had neither).
  const newProjectBtn = document.getElementById('new-project-btn');
  const importJsonBtn = document.getElementById('import-json-btn');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const importJsonFile = document.getElementById('import-json-file');
  newProjectBtn?.addEventListener('click', openNewProjectDialog);
  importJsonBtn?.addEventListener('click', () => importJsonFile?.click());
  importJsonFile?.addEventListener('change', importProjectJson);
  exportJsonBtn?.addEventListener('click', exportProjectJson);
  // beforeunload only saves when dirty (markProjectDirty is the single setter
  // of the flag, called on every mutation path), so closing a clean project
  // is free; a dirty one gets one cheap synchronous save.
  window.addEventListener('beforeunload', () => saveProject({ silent: true }));

  // Editable project name
  if (projectNameEl) {
    projectNameEl.addEventListener('blur', () => {
      if (currentProject) {
        currentProject.name = projectNameEl.textContent.trim() || 'Untitled Project';
        projectNameEl.textContent = currentProject.name;
      }
    });
    projectNameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); projectNameEl.blur(); }
    });
  }

  function initProject() {
    if (currentProjectId) {
      const projects = loadProjects();
      currentProject = projects.find(p => p.id === currentProjectId);
      if (currentProject) { projectNameEl.textContent = currentProject.name; loadProjectData(); }
      else createNewProject();
    } else {
      createNewProject();
    }
  }

  function createNewProject() {
    // P2 item 13/10: the project record comes from the core factory
    // (already normalized) — the editor keeps no second literal. The
    // blank scene keeps the editor's dark '#1e1e1e' background, unlike
    // the factory default (the white of script.js createScene).
    currentProject = window.HydraUniversal.createProject({
      id: generateId(),
      name: 'Untitled Project',
      scenes: [window.HydraUniversal.createScene({ id: 1, name: 'Scene 1', bgColor: '#1e1e1e' })]
    });
    currentProjectId = currentProject.id;
    localStorage.setItem('currentProjectId', currentProjectId);
    projectNameEl.textContent = currentProject.name;
    const projects = loadProjects();
    projects.push(currentProject);
    // A full store (quota) must not kill the editor load either: the
    // project still exists in memory and a later save can succeed.
    try { saveProjects(projects); } catch (err) { console.error('Could not save the new project:', err); }
  }

  function loadProjectData() {
    if (!currentProject) return;
    try {
      window.HydraUniversal?.normalizeProject(currentProject);
      // Restore assets
      if (currentProject.assets) {
        Object.assign(window.assetLibrary, currentProject.assets);
      }

      // Restore scenes
      if (currentProject.scenes?.length && typeof window.scenes !== 'undefined') {
        window.scenes.length = 0;
        currentProject.scenes.forEach(s => window.scenes.push(JSON.parse(JSON.stringify(s))));
      }

      if (typeof window.setCurrentSceneId === 'function') {
        window.setCurrentSceneId(currentProject.currentSceneId || currentProject.scenes?.[0]?.id || 1);
      }
      if (typeof window.setNextSceneId === 'function') {
        const maxSceneId = Math.max(0, ...(currentProject.scenes || []).map(s => Number(s.id) || 0));
        window.setNextSceneId(currentProject.nextSceneId || maxSceneId + 1);
      }
      if (typeof window.setActiveScriptScope === 'function') {
        window.setActiveScriptScope(currentProject.activeScriptScope || 'global');
      }

      // Restore global grid data
      if (currentProject.globalGridData && window.globalGridData) {
        Object.keys(window.globalGridData).forEach(k => delete window.globalGridData[k]);
        Object.assign(window.globalGridData, JSON.parse(JSON.stringify(currentProject.globalGridData)));
      }

      // After DOM settles, restore UI
      setTimeout(() => {
        if (typeof window.renderSceneObjects === 'function') window.renderSceneObjects();
        if (typeof window.refreshSceneList   === 'function') window.refreshSceneList();
        if (typeof window.preferCurrentSceneScriptIfGlobalEmpty === 'function') {
          window.preferCurrentSceneScriptIfGlobalEmpty();
        }
        if (typeof window.refreshScopeTabs   === 'function') window.refreshScopeTabs();
        // Load the active scope grid
        if (typeof window.loadGridForScope   === 'function') {
          window.loadGridForScope(window.getActiveScriptScope?.() || 'global');
        }
        if (typeof window.renderEventSheet === 'function') window.renderEventSheet();
        if (typeof window.refreshAssetManager === 'function') window.refreshAssetManager();
        window.HydraUniversal?.renderDiagnostics?.();
        // P3 item 18: static block validation runs once the project is in
        // the editor, so dangling references and broken expressions are
        // already in the diagnostics dock when the user opens the project.
        window.refreshValidationDiagnostics?.();
      }, 400);
    } catch (err) {
      console.error('Error loading project data:', err);
    }
  }

  function saveProject(options = {}) {
    if (!currentProject) return;
    // Skip when nothing changed: the debounced autosave and beforeunload both
    // funnel here, and markProjectDirty is the single setter of the flag.
    if (!options.force && window.hydraProjectDirty === false) return;
    try {
      // Save current script grid to active scope before serializing
      if (typeof window.commitActiveGrid === 'function') {
        window.commitActiveGrid({ dirty: false, autosave: false });
      } else if (typeof window.saveGridToScope === 'function') {
        window.saveGridToScope(window.getActiveScriptScope?.() || window.activeScriptScope || 'global');
      }

      // Reference the live stores directly instead of deep-cloning each one:
      // saveProjects() runs serializeProject(), which performs the single
      // deep clone needed for the localStorage snapshot. (Previously this
      // function cloned assets, scenes and grid data separately — 3-4 full
      // project clones per autosave tick.)
      currentProject.assets = window.assetLibrary || {};

      // Save scenes (includes each scene's gridData)
      if (typeof window.scenes !== 'undefined') {
        window.scenes.forEach(s => window.HydraUniversal?.normalizeScene?.(s, currentProject));
        currentProject.scenes = window.scenes;
        currentProject.sceneCount = currentProject.scenes.length;
      }

      // Save global grid data
      if (window.globalGridData) {
        currentProject.globalGridData = window.globalGridData;
      }
      window.HydraUniversal?.normalizeProject(currentProject);

      currentProject.currentSceneId    = window.getCurrentSceneId?.() || window.currentSceneId || currentProject.currentSceneId || 1;
      currentProject.nextSceneId       = window.getNextSceneId?.() || window.nextSceneId || currentProject.nextSceneId || 2;
      currentProject.activeScriptScope = window.getActiveScriptScope?.() || window.activeScriptScope || 'global';

      currentProject.name         = projectNameEl.textContent.trim() || 'Untitled Project';
      currentProject.lastModified = new Date().toISOString();

      const projects = loadProjects();
      const idx      = projects.findIndex(p => p.id === currentProject.id);
      if (idx !== -1) projects[idx] = currentProject; else projects.push(currentProject);

      try {
        saveProjects(projects);
      } catch (quotaErr) {
        // If storage quota exceeded, try saving without asset data
        alert('Storage full — project saved without image assets. Consider clearing browser storage.');
        const lightProject = JSON.parse(JSON.stringify(currentProject));
        lightProject.assets = {};
        lightProject.scenes.forEach(s => {
          s.bgAssetId = null;
          s.objects.forEach(o => { o.assetId = null; });
        });
        const idx2 = projects.findIndex(p => p.id === lightProject.id);
        if (idx2 !== -1) projects[idx2] = lightProject; else projects.push(lightProject);
        saveProjects(projects);
      }

      window.hydraProjectDirty = false;
      if (!options.silent) showSaveConfirmation();
    } catch (err) {
      console.error('Error saving project:', err);
      alert('Error saving project: ' + err.message);
    }
  }

  function exportPlayableGame() {
    openExportDialog();
  }

  // P4 E1: the Export button opens the target picker dialog. Each target is
  // a complete package with a guided checklist in the dialog (what the
  // engine generated, what the user runs, what cannot be automated).
  // P3 item 17 (accessibility): focus moves into the dialog on open and
  // returns to the Export button on close.
  let exportDialogOpener = null;
  function openExportDialog() {
    const dlg = document.getElementById('export-dialog');
    if (!dlg) { downloadStandalone(); return; } // markup missing: keep the old one-click path
    exportDialogOpener = document.activeElement;
    dlg.classList.add('open');
    wireExportDialogOnce();
    document.getElementById('export-dialog-close')?.focus();
  }
  function closeExportDialog() {
    document.getElementById('export-dialog')?.classList.remove('open');
    if (exportDialogOpener && document.contains(exportDialogOpener)) {
      exportDialogOpener.focus();
      exportDialogOpener = null;
    }
  }
  let exportDialogWired = false;
  function wireExportDialogOnce() {
    if (exportDialogWired) return;
    exportDialogWired = true;
    const dlg = document.getElementById('export-dialog');
    document.getElementById('export-dialog-close')?.addEventListener('click', closeExportDialog);
    dlg?.addEventListener('click', (e) => { if (e.target === dlg) closeExportDialog(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dlg?.classList.contains('open')) closeExportDialog();
    });
    document.getElementById('export-download-standalone')
      ?.addEventListener('click', (e) => runExportDownload(e.currentTarget, 'Exporting...', downloadStandalone));
    document.getElementById('export-download-webzip')
      ?.addEventListener('click', (e) => runExportDownload(e.currentTarget, 'Building ZIP...', downloadWebZip));
    document.getElementById('export-download-pwa')
      ?.addEventListener('click', (e) => runExportDownload(e.currentTarget, 'Building PWA...', downloadPwa));
    document.getElementById('export-download-desktop')
      ?.addEventListener('click', (e) => runExportDownload(e.currentTarget, 'Building desktop project...', downloadDesktop));
    // Target 5 is split into two hub cards (Android / iOS); both download
    // the same Capacitor project, which covers both native platforms.
    document.getElementById('export-download-android')
      ?.addEventListener('click', (e) => runExportDownload(e.currentTarget, 'Building mobile project...', downloadMobile));
    document.getElementById('export-download-ios')
      ?.addEventListener('click', (e) => runExportDownload(e.currentTarget, 'Building mobile project...', downloadMobile));
    // P4 E4: one-click copy for the command chips on the export hub cards.
    dlg?.addEventListener('click', (e) => {
      const chip = e.target && e.target.closest ? e.target.closest('.export-cmd') : null;
      if (chip && chip.getAttribute('data-cmd')) copyExportCommand(chip);
    });
  }

  // Runs an export download with a busy state on its button. The 30ms defer
  // lets the busy state paint before the synchronous build starts.
  function runExportDownload(btn, busyLabel, fn) {
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + busyLabel;
    const restore = () => { btn.disabled = false; btn.innerHTML = originalHtml; };
    setTimeout(() => {
      Promise.resolve()
        .then(fn)
        .catch((err) => {
          console.error('Export failed:', err);
          alert('Export failed: ' + (err && err.message ? err.message : err));
        })
        .then(restore);
    }, 30);
  }

  // P4 E4: one-click copy for the command chips on the export hub cards.
  // Tries the async clipboard API first (works on localhost + HTTPS);
  // falls back to the execCommand path. Always gives visual feedback so a
  // click never feels dead, even if the clipboard write is denied.
  async function copyExportCommand(chip) {
    const cmd = chip.getAttribute('data-cmd') || '';
    if (!cmd) return;
    let ok = true;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cmd);
      } else {
        const ta = document.createElement('textarea');
        ta.value = cmd;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = !!document.execCommand('copy');
        ta.remove();
      }
    } catch (e) { ok = false; }
    paintExportCmdChip(chip, cmd, ok ? 'Copied!' : cmd, ok ? 'copied' : 'copy-failed');
    setTimeout(() => paintExportCmdChip(chip, cmd, cmd, ''), 1200);
  }

  // Rebuilds a command chip's contents with DOM APIs (no innerHTML from
  // attribute data), so a hostile data-cmd can never inject markup.
  function paintExportCmdChip(chip, cmd, label, stateClass) {
    chip.classList.remove('copied', 'copy-failed');
    if (stateClass) chip.classList.add(stateClass);
    chip.textContent = '';
    const code = document.createElement('code');
    code.textContent = label;
    const icon = document.createElement('i');
    icon.className = stateClass === 'copied' ? 'fas fa-check' : 'fas fa-copy';
    icon.setAttribute('aria-hidden', 'true');
    chip.appendChild(code);
    chip.appendChild(icon);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function exportBaseName(project) {
    return ((project && project.name) || 'hydra-game').replace(/[^a-z0-9_-]+/gi, '_');
  }

  function requireWebExport() {
    if (!window.HydraWebExport?.buildZip || !window.HydraPlayer?.buildWebTarget) {
      throw new Error('Web exporter is not loaded (hydra-webexport.js).');
    }
  }

  function requireDesktopExport() {
    if (!window.HydraWebExport?.buildZip || !window.HydraDesktopExport?.buildDesktopFiles ||
        !window.HydraPlayer?.buildDesktopTarget) {
      throw new Error('Desktop exporter is not loaded (hydra-webexport.js + hydra-desktopexport.js).');
    }
  }

  function requireMobileExport() {
    if (!window.HydraWebExport?.buildZip || !window.HydraMobileExport?.buildMobileFiles ||
        !window.HydraPlayer?.buildMobileTarget) {
      throw new Error('Mobile exporter is not loaded (hydra-webexport.js + hydra-mobileexport.js).');
    }
  }

  // Target 5: mobile wrapper — a complete Capacitor project ZIP
  // (package.json, capacitor.config.json, README, www/, resources/).
  // The native Android/iOS projects generate on the user's machine via
  // `npx cap add`; the guided checklist on the card and in the README
  // says so honestly, along with the Play Store signing-key and
  // macOS+Xcode-for-iOS requirements.
  async function downloadMobile() {
    if (!currentProject) return;
    requireMobileExport();
    saveProject({ silent: true });
    const WE = window.HydraWebExport;
    const project = JSON.parse(JSON.stringify(currentProject));
    const gameName = project.name || 'Hydra Game';
    let iconBytes = null, splashBytes = null;
    try {
      const resourceFiles = await renderIconFiles(WE, gameName, [
        { path: 'resources/icon.png', size: 1024 },
        { path: 'resources/splash.png', size: 1024 }
      ]);
      if (resourceFiles && resourceFiles[0] && resourceFiles[0].bytes) iconBytes = resourceFiles[0].bytes;
      if (resourceFiles && resourceFiles[1] && resourceFiles[1].bytes) splashBytes = resourceFiles[1].bytes;
    } catch (e) {
      // Branded resources are nice-to-have; the project builds without them.
      console.warn('Mobile export: resource render failed, continuing without icon/splash.', e);
    }
    const target = window.HydraPlayer.buildMobileTarget(project, { iconPngBytes: iconBytes, splashPngBytes: splashBytes });
    const zip = WE.buildZip(target.files);
    downloadBlob(new Blob([zip], { type: 'application/zip' }),
      `${exportBaseName(project)}_mobile.zip`);
  }

  // Target 4: desktop wrapper — a complete Electron + electron-builder
  // project ZIP (package.json, main.js, README, game/, build/icon.png).
  // The actual binary build (npm run dist) runs on the user's machine;
  // the guided checklist on the card and in the README says so honestly.
  async function downloadDesktop() {
    if (!currentProject) return;
    requireDesktopExport();
    saveProject({ silent: true });
    const WE = window.HydraWebExport;
    const project = JSON.parse(JSON.stringify(currentProject));
    const gameName = project.name || 'Hydra Game';
    let iconBytes = null;
    try {
      const iconFiles = await renderIconFiles(WE, gameName, [{ path: 'build/icon.png', size: 512 }]);
      if (iconFiles && iconFiles[0] && iconFiles[0].bytes) iconBytes = iconFiles[0].bytes;
    } catch (e) {
      // A branded icon is nice-to-have; the project builds without one.
      console.warn('Desktop export: icon render failed, continuing without an icon.', e);
    }
    const target = window.HydraPlayer.buildDesktopTarget(project, { iconPngBytes: iconBytes });
    const zip = WE.buildZip(target.files);
    downloadBlob(new Blob([zip], { type: 'application/zip' }),
      `${exportBaseName(project)}_desktop.zip`);
  }

  // Target 1: classic single-file HTML (the pre-E1 behavior).
  function downloadStandalone() {
    if (!currentProject) return;
    saveProject({ silent: true });
    if (!window.HydraPlayer?.buildPlayableHtml) {
      alert('Playable exporter is not loaded.');
      return;
    }
    const playableProject = JSON.parse(JSON.stringify(currentProject));
    const html = window.HydraPlayer.buildPlayableHtml(playableProject);
    downloadBlob(new Blob([html], { type: 'text/html' }),
      `${exportBaseName(playableProject)}_playable.html`);
  }

  // Target 2: itch.io-ready ZIP — index.html + assets/ folder, relative paths.
  function downloadWebZip() {
    if (!currentProject) return;
    requireWebExport();
    saveProject({ silent: true });
    const WE = window.HydraWebExport;
    const project = JSON.parse(JSON.stringify(currentProject));
    const target = window.HydraPlayer.buildWebTarget(project, {});
    const files = [{ path: 'index.html', bytes: WE.utf8Bytes(target.indexHtml) }]
      .concat(target.files);
    const zip = WE.buildZip(files);
    downloadBlob(new Blob([zip], { type: 'application/zip' }),
      `${exportBaseName(project)}_itch.zip`);
  }

  // Target 3: PWA ZIP — web target + manifest + offline service worker +
  // canvas-rendered icons (192/512).
  async function downloadPwa() {
    if (!currentProject) return;
    requireWebExport();
    saveProject({ silent: true });
    const WE = window.HydraWebExport;
    const project = JSON.parse(JSON.stringify(currentProject));
    const gameName = project.name || 'Hydra Game';
    const icons = [
      { path: 'icons/icon-192.png', sizes: '192x192' },
      { path: 'icons/icon-512.png', sizes: '512x512' }
    ];
    const target = window.HydraPlayer.buildWebTarget(project, {
      pwa: {
        name: gameName, shortName: gameName,
        themeColor: '#f59e0b', backgroundColor: '#0f172a',
        icons
      }
    });
    const files = [
      { path: 'index.html', bytes: WE.utf8Bytes(target.indexHtml) },
      { path: 'manifest.webmanifest', bytes: WE.utf8Bytes(target.manifest) },
      { path: 'sw.js', bytes: WE.utf8Bytes(target.serviceWorker) }
    ].concat(target.files);
    const iconFiles = await renderIconFiles(WE, gameName, [
      { path: 'icons/icon-192.png', size: 192 },
      { path: 'icons/icon-512.png', size: 512 }
    ]);
    const zip = WE.buildZip(files.concat(iconFiles));
    downloadBlob(new Blob([zip], { type: 'application/zip' }),
      `${exportBaseName(project)}_pwa.zip`);
  }

  function renderIconFiles(WE, gameName, specs) {
    return Promise.all(specs.map((spec) => new Promise((resolve, reject) => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = spec.size;
        WE.drawIcon(c.getContext('2d'), spec.size, gameName);
        c.toBlob((blob) => {
          if (!blob) { reject(new Error('icon render failed')); return; }
          blob.arrayBuffer()
            .then((ab) => resolve({ path: spec.path, bytes: new Uint8Array(ab), mime: 'image/png' }))
            .catch(reject);
        }, 'image/png');
      } catch (e) { reject(e); }
    })));
  }

  // ---- P3 item 15: editor project JSON import/export + templates ----
  function safeJsonFileName(value, fallback = 'hydra_project') {
    const name = (typeof value === 'string' && value.trim() ? value.trim() : fallback)
      .replace(/[<>:\"/\\|?*\x00-\x1f]+/g, '_').replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '').slice(0, 80);
    return name || fallback;
  }

  function exportProjectJson() {
    if (!currentProject) return;
    // Commit the live grid first, so the downloaded file matches the editor.
    saveProject({ silent: true });
    const clean = window.HydraUniversal?.serializeProject
      ? window.HydraUniversal.serializeProject(currentProject) : currentProject;
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeJsonFileName(currentProject.name)}.hydra`);
  }

  function importProjectJson(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (event) {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Invalid project file');
        }
        // Same record hygiene as the hub import path (home.js), so a file
        // exported from the hub, the editor, or an older version all load.
        const now = new Date().toISOString();
        const imported = parsed;
        imported.id = (typeof imported.id === 'string' && imported.id.trim()
          ? imported.id.trim() : generateId()).replace(/[^a-z0-9_-]/gi, '');
        imported.name = (typeof imported.name === 'string' && imported.name.trim()
          ? imported.name.trim() : 'Untitled Project').slice(0, 120);
        imported.dateCreated = Number.isNaN(Date.parse(imported.dateCreated)) ? now : imported.dateCreated;
        imported.lastModified = Number.isNaN(Date.parse(imported.lastModified)) ? imported.dateCreated : imported.lastModified;
        imported.scenes = Array.isArray(imported.scenes) ? imported.scenes : [];
        imported.sceneCount = imported.scenes.length || Number(imported.sceneCount) || 0;
        imported.assets = imported.assets && typeof imported.assets === 'object' ? imported.assets : {};
        window.HydraUniversal?.normalizeProject?.(imported);
        // Save the project being left, then open the imported one. A reload
        // is the clean handoff: it re-runs the normal load path (assets,
        // scenes, grids, inspector) instead of partially re-rendering it.
        saveProject({ silent: true });
        const projects = loadProjects();
        const clash = projects.findIndex(p => p.id === imported.id);
        if (clash !== -1 && (!currentProject || projects[clash].id !== currentProject.id)) {
          imported.id = generateId();
        }
        const idx = projects.findIndex(p => p.id === imported.id);
        if (idx !== -1) projects[idx] = imported; else projects.push(imported);
        saveProjects(projects);
        localStorage.setItem('currentProjectId', imported.id);
        e.target.value = '';
        window.location.reload();
      } catch (error) {
        e.target.value = '';
        alert('Failed to import project: ' + error.message);
      }
    };
    reader.readAsText(file);
  }

  function newProjectTemplates() {
    const list = window.HydraStarterTemplates?.templates;
    return Array.isArray(list) && list.length
      ? list : [{ id: 'blank', name: 'Blank Canvas', description: 'Clean scene with no starter logic.' }];
  }

  function openNewProjectDialog() {
    const dialog = document.getElementById('new-project-dialog');
    const select = document.getElementById('new-project-template');
    const desc = document.getElementById('new-project-template-desc');
    const nameInput = document.getElementById('new-project-name');
    if (!dialog || !select) return;
    // P3 item 17 (accessibility): focus returns to the New button on close.
    newProjectDialogOpener = document.activeElement;
    select.innerHTML = '';
    newProjectTemplates().forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name;
      select.appendChild(opt);
    });
    const syncDesc = () => {
      const t = newProjectTemplates().find(x => x.id === select.value);
      if (desc) desc.textContent = t ? (t.description || '') : '';
    };
    select.onchange = syncDesc;
    syncDesc();
    if (nameInput) nameInput.value = '';
    dialog.classList.add('open');
    if (nameInput) nameInput.focus();
  }

  let newProjectDialogOpener = null;
  function closeNewProjectDialog() {
    document.getElementById('new-project-dialog')?.classList.remove('open');
    if (newProjectDialogOpener && document.contains(newProjectDialogOpener)) {
      newProjectDialogOpener.focus();
      newProjectDialogOpener = null;
    }
  }

  function createProjectFromDialog() {
    const select = document.getElementById('new-project-template');
    const nameInput = document.getElementById('new-project-name');
    const name = (nameInput?.value || '').trim() || 'Untitled Project';
    const templateId = select?.value || 'blank';
    saveProject({ silent: true });
    let created;
    if (window.HydraStarterTemplates?.createProject) {
      created = window.HydraStarterTemplates.createProject(templateId, name, generateId);
    } else {
      createNewProject();
      currentProject.name = name;
      if (projectNameEl) projectNameEl.textContent = name;
      created = currentProject;
    }
    window.HydraUniversal?.normalizeProject?.(created);
    const projects = loadProjects();
    const idx = projects.findIndex(p => p.id === created.id);
    if (idx !== -1) projects[idx] = created; else projects.push(created);
    saveProjects(projects);
    localStorage.setItem('currentProjectId', created.id);
    closeNewProjectDialog();
    window.location.reload();
  }

  document.getElementById('new-project-dialog-close')?.addEventListener('click', closeNewProjectDialog);
  document.getElementById('new-project-cancel-btn')?.addEventListener('click', closeNewProjectDialog);
  document.getElementById('new-project-create-btn')?.addEventListener('click', createProjectFromDialog);
  document.getElementById('new-project-dialog')?.addEventListener('click', (e) => {
    if (e.target.id === 'new-project-dialog') closeNewProjectDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('new-project-dialog')?.classList.contains('open')) {
      closeNewProjectDialog();
    }
  });

  function returnToHome() { saveProject(); window.location.href = 'home.html?v=20260811-fixed1'; }

  // P1 item 16 (resilience): mirror the hub loader — a damaged store is
  // backed up, reported once, and never takes the editor down; a single
  // damaged record is repaired or dropped, never the whole list.
  let storeCorruptNotified = false;
  function loadProjects() {
    let raw = null;
    try {
      raw = localStorage.getItem('hydraProjects');
    } catch (error) {
      console.error('Error loading projects:', error);
      return [];
    }
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('Error loading projects: the saved project list is not valid JSON:', error);
      backupCorruptStore(raw);
      notifyStoreCorrupt();
      return [];
    }
    if (!Array.isArray(parsed)) {
      console.error('Error loading projects: the saved project list is not a list.');
      backupCorruptStore(raw);
      notifyStoreCorrupt();
      return [];
    }
    const kept = [];
    parsed.forEach(record => {
      try {
        if (record && typeof record === 'object') {
          window.HydraUniversal?.normalizeProject?.(record);
          kept.push(record);
        }
      } catch (error) {
        console.warn('Skipping a saved project that could not be repaired:', error);
      }
    });
    return kept;
  }

  function backupCorruptStore(raw) {
    try {
      localStorage.setItem('hydraProjects.corrupt.' + Date.now(), raw);
      return true;
    } catch (error) {
      console.error('Could not back up the damaged project list:', error);
      return false;
    }
  }

  function notifyStoreCorrupt() {
    if (storeCorruptNotified) return;
    storeCorruptNotified = true;
    alert('Your saved project list could not be read because the stored data is damaged. A backup copy was kept in this browser, and the editor opened a fresh project instead.');
  }

  function saveProjects(projects) {
    // Strip alias duplicates (logicGrids.global/main, per-scene logicGrids
    // entries, scene.entities) so scripts/objects aren't stored 2-3x.
    // normalizeProject() restores the aliases on load.
    const serializable = window.HydraUniversal?.serializeProject
      ? projects.map(p => window.HydraUniversal.serializeProject(p))
      : projects;
    localStorage.setItem('hydraProjects', JSON.stringify(serializable));
  }

  function showSaveConfirmation() {
    const el = document.createElement('div');
    el.className = 'save-confirmation';
    el.innerHTML = '<i class="fas fa-check"></i> Project saved';
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.add('show');
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2000);
    }, 10);
  }

  function generateId() { return Math.random().toString(16).slice(2) + Date.now().toString(16); }

  window.projectManager = { saveProject, getCurrentProject: () => currentProject };
});
