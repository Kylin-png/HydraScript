// Project management — project.js (v3)
document.addEventListener('DOMContentLoaded', function () {
  const projectNameEl  = document.getElementById('project-name');
  const saveBtn        = document.getElementById('save-project-btn');
  const exportPlayableBtn = document.getElementById('export-playable-btn');
  const homeBtn        = document.getElementById('home-btn');

  let currentProject   = null;
  let currentProjectId = localStorage.getItem('currentProjectId');

  initProject();
  saveBtn.addEventListener('click', saveProject);
  exportPlayableBtn?.addEventListener('click', exportPlayableGame);
  homeBtn.addEventListener('click', returnToHome);
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
    currentProject = {
      id: generateId(), name: 'Untitled Project',
      dateCreated: new Date().toISOString(), lastModified: new Date().toISOString(),
      eventsVersion: 1,
      globalGridData: {},
      logicGrids: { global: {} },
      eventSheets: [],
      scenes: [{
        id: 1, name: 'Scene 1', objects: [],
        bgColor: '#1e1e1e', bgAssetId: null,
        width: 800, height: 600,
        worldWidth: 800, worldHeight: 600,
        viewportWidth: 800, viewportHeight: 600,
        gridData: {},
        logicGrids: { main: {} },
        eventSheets: []
      }],
      currentSceneId: 1,
      nextSceneId: 2,
      activeScriptScope: 'global',
      sceneCount: 1,
      assets: {} // assetId -> {name, dataUrl}
    };
    window.HydraUniversal?.normalizeProject(currentProject);
    currentProjectId = currentProject.id;
    localStorage.setItem('currentProjectId', currentProjectId);
    projectNameEl.textContent = currentProject.name;
    const projects = loadProjects();
    projects.push(currentProject);
    saveProjects(projects);
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
        window.HydraUniversal?.renderDiagnostics?.();
      }, 400);
    } catch (err) {
      console.error('Error loading project data:', err);
    }
  }

  function saveProject(options = {}) {
    if (!currentProject) return;
    try {
      // Save current script grid to active scope before serializing
      if (typeof window.commitActiveGrid === 'function') {
        window.commitActiveGrid({ dirty: false, autosave: false });
      } else if (typeof window.saveGridToScope === 'function') {
        window.saveGridToScope(window.getActiveScriptScope?.() || window.activeScriptScope || 'global');
      }

      // Save assets
      currentProject.assets = JSON.parse(JSON.stringify(window.assetLibrary || {}));

      // Save scenes (includes each scene's gridData)
      if (typeof window.scenes !== 'undefined') {
        window.scenes.forEach(s => window.HydraUniversal?.normalizeScene?.(s, currentProject));
        currentProject.scenes = JSON.parse(JSON.stringify(window.scenes));
        currentProject.sceneCount = currentProject.scenes.length;
      }

      // Save global grid data
      if (window.globalGridData) {
        currentProject.globalGridData = JSON.parse(JSON.stringify(window.globalGridData));
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
    if (!currentProject) return;
    saveProject({ silent: true });
    if (!window.HydraPlayer?.buildPlayableHtml) {
      alert('Playable exporter is not loaded.');
      return;
    }
    const playableProject = JSON.parse(JSON.stringify(currentProject));
    const html = window.HydraPlayer.buildPlayableHtml(playableProject);
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(playableProject.name || 'hydra-game').replace(/[^a-z0-9_-]+/gi, '_')}_playable.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function returnToHome() { saveProject(); window.location.href = 'home.html?v=20260811-fixed1'; }

  function loadProjects() {
    try { return JSON.parse(localStorage.getItem('hydraProjects') || '[]'); }
    catch { return []; }
  }

  function saveProjects(projects) {
    localStorage.setItem('hydraProjects', JSON.stringify(projects));
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
