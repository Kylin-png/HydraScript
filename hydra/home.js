// Project data structure management
document.addEventListener('DOMContentLoaded', function() {
  const APP_CACHE_VERSION = '20261104-brand1';
  // DOM Elements
  const projectsList = document.getElementById('projects-list');
  const recentProjectsList = document.getElementById('recent-projects-list');
  const newProjectBtnMain = document.getElementById('new-project-btn-main');
  const wizardOverlay = document.getElementById('new-project-wizard-overlay');
  const wizardContainer = document.getElementById('wizard-container');
  const closeWizardBtn = document.getElementById('close-wizard-btn');
  const cancelWizardBtn = document.getElementById('cancel-wizard-btn');
  const createProjectBtn = document.getElementById('create-project-btn');
  const newProjectForm = document.getElementById('new-project-form');
  const projectNameInput = document.getElementById('project-name-input');
  const templateSelector = document.getElementById('template-selector');
  
  const importProjectBtn = document.getElementById('import-project-btn');
  const loadProjectFile = document.getElementById('load-project-file');
  const exportAllBtn = document.getElementById('export-all-btn');
  const searchInput = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');

  // P1 item 16 (resilience): state for the damaged-store path. When the
  // saved list cannot be read at all, loadProjects() sets storeCorrupt and
  // tries to keep the raw bytes under a backup key; saveProjects() refuses
  // to overwrite the store while it is corrupt and un-backed-up.
  let storeCorrupt = false;
  let storeBackupOk = false;

  // Load projects from localStorage
  let projects = loadProjects();
  let selectedTemplateId = 'blank';
  renderProjects();

  // Event Listeners
  if (newProjectBtnMain) newProjectBtnMain.addEventListener('click', () => toggleWizard(true));
  if (closeWizardBtn) closeWizardBtn.addEventListener('click', () => toggleWizard(false));
  if (cancelWizardBtn) cancelWizardBtn.addEventListener('click', () => toggleWizard(false));
  if (createProjectBtn) createProjectBtn.addEventListener('click', createNewProject);
  if (templateSelector) {
    templateSelector.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', () => selectTemplate(card.dataset.template || 'blank'));
    });
  }
  
  if (importProjectBtn) {
    importProjectBtn.addEventListener('click', () => loadProjectFile.click());
  }
  
  if (loadProjectFile) loadProjectFile.addEventListener('change', importProject);
  if (exportAllBtn) exportAllBtn.addEventListener('click', exportAllProjects);
  
  if (searchInput) {
    searchInput.addEventListener('input', () => renderProjects(searchInput.value));
  }
  
  if (sortSelect) {
    sortSelect.addEventListener('change', () => renderProjects(searchInput ? searchInput.value : ''));
  }

  // Functions
  function toggleWizard(show) {
    if (show) {
      wizardOverlay.classList.remove('hidden');
      setTimeout(() => {
        wizardOverlay.classList.add('opacity-100');
        wizardContainer.classList.remove('scale-95');
        wizardContainer.classList.add('scale-100');
      }, 10);
      if (projectNameInput) projectNameInput.focus();
    } else {
      wizardOverlay.classList.remove('opacity-100');
      wizardContainer.classList.remove('scale-100');
      wizardContainer.classList.add('scale-95');
      setTimeout(() => {
        wizardOverlay.classList.add('hidden');
        if (newProjectForm) newProjectForm.reset();
      }, 300);
    }
  }

  function selectTemplate(templateId) {
    selectedTemplateId = templateId || 'blank';
    if (!templateSelector) return;
    templateSelector.querySelectorAll('.template-card').forEach(card => {
      const active = card.dataset.template === selectedTemplateId;
      card.classList.toggle('border-primary', active);
      card.classList.toggle('border-2', active);
      card.classList.toggle('bg-blue-50', active);
      card.classList.toggle('dark:bg-blue-900/20', active);
      card.classList.toggle('border-gray-200', !active);
      card.classList.toggle('dark:border-gray-700', !active);
    });
  }

  function loadProjects() {
    let raw = null;
    try {
      raw = localStorage.getItem('hydraProjects');
    } catch (error) {
      console.error('Error loading projects: could not read local storage:', error);
      return [];
    }
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('Error loading projects: the saved project list is not valid JSON:', error);
      storeCorrupt = true;
      storeBackupOk = backupCorruptStore(raw);
      showStoreNotice(storeBackupOk
        ? 'Your saved project list could not be read because the stored data is damaged. A backup copy was kept in this browser, and the list below starts empty.'
        : 'Your saved project list could not be read because the stored data is damaged, and no backup copy could be saved (browser storage may be full). Nothing has been overwritten; free up storage before creating a project.');
      return [];
    }
    if (!Array.isArray(parsed)) {
      console.error('Error loading projects: the saved project list is not a list.');
      storeCorrupt = true;
      storeBackupOk = backupCorruptStore(raw);
      showStoreNotice('Your saved project list is damaged (it is not a list of projects). A backup copy was kept in this browser, and the list below starts empty.');
      return [];
    }
    // Repair each record on its own: one damaged project must never take
    // the whole list down with it.
    const kept = [];
    let dropped = 0;
    parsed.forEach(record => {
      try {
        const clean = normalizeProjectRecord(record);
        if (clean) kept.push(clean); else dropped++;
      } catch (error) {
        dropped++;
        console.warn('Skipping a saved project that could not be repaired:', error);
      }
    });
    if (dropped > 0) {
      showStoreNotice(`${dropped} saved project${dropped === 1 ? '' : 's'} could not be repaired and ${dropped === 1 ? 'was' : 'were'} skipped. Your other projects are unaffected.`);
    }
    return kept;
  }

  // Keep the raw bytes of a damaged store under a dated backup key, so a
  // later save can never silently destroy the only copy. Returns false
  // when even the backup cannot be written (storage full).
  function backupCorruptStore(raw) {
    try {
      localStorage.setItem('hydraProjects.corrupt.' + Date.now(), raw);
      return true;
    } catch (error) {
      console.error('Could not back up the damaged project list:', error);
      return false;
    }
  }

  // A visible notice above the project list (inline styles, so it renders
  // even when the Tailwind CDN is down and the fallback stylesheet is in
  // play). Messages accumulate into one banner; it dismisses per page load.
  function showStoreNotice(message) {
    const host = projectsList && projectsList.parentNode;
    if (!host) { console.warn('HydraScript: ' + message); return; }
    let banner = document.getElementById('hydra-store-notice');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hydra-store-notice';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'background:#fffbeb;border:1px solid #f59e0b;color:#92400e;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px;line-height:1.5';
      const text = document.createElement('span');
      text.id = 'hydra-store-notice-text';
      banner.appendChild(text);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Dismiss';
      dismiss.style.cssText = 'float:right;background:none;border:none;color:#92400e;text-decoration:underline;cursor:pointer;font-size:13px;margin-left:12px';
      dismiss.addEventListener('click', () => banner.remove());
      banner.appendChild(dismiss);
      host.insertBefore(banner, projectsList);
    }
    const text = document.getElementById('hydra-store-notice-text');
    if (text) text.textContent = (text.textContent ? text.textContent + ' ' : '') + message;
  }

  function saveProjects(projects) {
    // Never overwrite the only copy of a damaged store when no backup
    // exists: refuse the write and say so instead of destroying data.
    if (storeCorrupt && !storeBackupOk) {
      alert('Your saved project list is damaged and no backup copy could be saved, so this change was not written. Free up browser storage and reload the page to try again.');
      return;
    }
    try {
      // Strip alias duplicates before saving (see project.js); the hub also
      // loads hydra-universal.js so imports get normalized on load.
      const serializable = window.HydraUniversal?.serializeProject
        ? projects.map(p => window.HydraUniversal.serializeProject(p))
        : projects;
      localStorage.setItem('hydraProjects', JSON.stringify(serializable));
      // The backup key holds the old damaged bytes, so the store is safe
      // to overwrite from here on.
      if (storeCorrupt) storeCorrupt = false;
    } catch (error) {
      console.error('Error saving projects:', error);
      alert('Failed to save projects to local storage. Your storage might be full.');
    }
  }

  function safeString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function safeFileName(value, fallback = 'hydra_project') {
    const name = safeString(value, fallback)
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    return name || fallback;
  }

  function normalizeProjectRecord(project) {
    if (!project || typeof project !== 'object') return null;
    const now = new Date().toISOString();
    project.id = safeString(project.id, generateId()).replace(/[^a-z0-9_-]/gi, '');
    project.name = safeString(project.name, 'Untitled Project').slice(0, 120);
    project.dateCreated = Number.isNaN(Date.parse(project.dateCreated)) ? now : project.dateCreated;
    project.lastModified = Number.isNaN(Date.parse(project.lastModified)) ? project.dateCreated : project.lastModified;
    project.scenes = Array.isArray(project.scenes) ? project.scenes : [];
    project.sceneCount = project.scenes.length || Number(project.sceneCount) || 0;
    project.assets = project.assets && typeof project.assets === 'object' ? project.assets : {};
    window.HydraUniversal?.normalizeProject?.(project);
    return project;
  }

  function getProjectHue(project) {
    const id = safeString(project?.id, '0');
    const colorSeed = parseInt(id.substring(0, 6), 16);
    return Number.isFinite(colorSeed) ? colorSeed % 360 : 210;
  }

  function renderProjects(filter = '') {
    if (!projectsList) return;
    projectsList.innerHTML = '';
    
    let filteredProjects = projects.filter(p => safeString(p.name, 'Untitled Project').toLowerCase().includes(filter.toLowerCase()));
    
    // Sorting
    const sortBy = sortSelect ? sortSelect.value : 'modified';
    if (sortBy === 'name') {
      filteredProjects.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'created') {
      filteredProjects.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));
    } else {
      filteredProjects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    }
    
    filteredProjects.forEach(project => {
      const projectElement = document.createElement('div');
      projectElement.className = 'group relative bg-white dark:bg-[#1e1e1e] rounded-lg border border-gray-200 dark:border-[#333] shadow-sm hover:shadow-editor hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-200 flex flex-col overflow-hidden';
      
      const projectName = safeString(project.name, 'Untitled Project');
      const escapedName = escapeHtml(projectName);
      const colorHue = getProjectHue(project);
      const sceneCount = Number(project.sceneCount || project.scenes?.length || 0) || 0;
      
      projectElement.innerHTML = `
        <div class="relative h-40 bg-gray-100 dark:bg-[#111] border-b border-gray-100 dark:border-[#333]">
          <div class="absolute inset-0 m-4 rounded bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-inner" style="background: linear-gradient(135deg, hsl(${colorHue}, 70%, 60%), hsl(${(colorHue + 40) % 360}, 70%, 50%))">
            <span class="text-4xl font-light text-white opacity-80">${escapeHtml(projectName.charAt(0).toUpperCase())}</span>
          </div>
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-[1px]">
            <button class="bg-primary text-white px-4 py-1.5 rounded text-sm font-medium shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform project-open-btn" data-project-id="${project.id}">Open Editor</button>
          </div>
        </div>
        <div class="p-4 flex-1 flex flex-col">
          <div class="flex justify-between items-start mb-1">
            <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 truncate pr-2 group-hover:text-primary transition-colors">${escapedName}</h3>
            <span class="text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">v0.1</span>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-500 mb-4">${sceneCount} Scenes &middot; Last edited ${escapeHtml(formatTime(project.lastModified))}</p>
          <div class="mt-auto flex items-center justify-between pt-3 border-t border-gray-100 dark:border-[#2a2a2a]">
            <div class="flex items-center text-gray-400 hover:text-blue-500 transition-colors cursor-pointer" title="Open Folder">
              <span class="material-icons text-lg">folder</span>
            </div>
            <div class="flex items-center space-x-3">
              <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors project-rename-btn" title="Rename" aria-label="Rename project" data-project-id="${project.id}" data-project-name="${escapedName}">
                <span class="material-icons text-lg">edit</span>
              </button>
              <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors project-export-btn" title="Backup" aria-label="Download project backup" data-project-id="${project.id}">
                <span class="material-icons text-lg">download</span>
              </button>
              <button class="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors project-delete-btn" title="Delete" aria-label="Delete project" data-project-id="${project.id}">
                <span class="material-icons text-lg">delete</span>
              </button>
            </div>
          </div>
        </div>
      `;
      
      projectsList.appendChild(projectElement);
    });

    // Add Create New Project card as the last item
    const createCard = document.createElement('div');
    createCard.className = 'group relative bg-gray-50 dark:bg-[#1a1a1a] rounded-lg border-2 border-dashed border-gray-300 dark:border-[#333] hover:border-primary dark:hover:border-primary hover:bg-white dark:hover:bg-[#1e1e1e] transition-all duration-200 flex flex-col items-center justify-center min-h-[280px] cursor-pointer';
    createCard.innerHTML = `
      <div class="flex flex-col items-center text-gray-400 dark:text-gray-500 group-hover:text-primary transition-colors">
        <span class="material-icons text-4xl mb-2">add_circle_outline</span>
        <span class="text-sm font-medium">Create New Project</span>
      </div>
    `;
    createCard.addEventListener('click', () => toggleWizard(true));
    projectsList.appendChild(createCard);

    // F1 polish: guided empty state when a search matches nothing.
    if (filteredProjects.length === 0 && filter.trim() !== '') {
      const noResults = document.createElement('div');
      noResults.className = 'col-span-full flex flex-col items-center text-center py-10';
      noResults.innerHTML = `
        <span class="material-icons text-4xl text-gray-300 dark:text-gray-600 mb-3">search_off</span>
        <p class="text-sm font-medium text-gray-600 dark:text-gray-400">No projects match "${escapeHtml(filter.trim())}"</p>
        <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Try a different search, or start something new.</p>
      `;
      projectsList.appendChild(noResults);
    }

    // Render Recent Sidebar
    if (recentProjectsList) {
      recentProjectsList.innerHTML = '';
      projects.slice(0, 3).forEach(project => {
        const recentLink = document.createElement('a');
        recentLink.className = 'flex items-center px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md truncate transition-colors cursor-pointer';
        const colorHue = getProjectHue(project);
        recentLink.innerHTML = `
          <span class="w-2 h-2 rounded-full mr-3" style="background-color: hsl(${colorHue}, 70%, 60%)"></span>
          ${escapeHtml(safeString(project.name, 'Untitled Project'))}
        `;
        recentLink.addEventListener('click', () => openProject(project.id));
        recentProjectsList.appendChild(recentLink);
      });
    }
    
    // Add event listeners
    document.querySelectorAll('.project-open-btn').forEach(btn => {
      btn.addEventListener('click', () => openProject(btn.getAttribute('data-project-id')));
    });
    
    document.querySelectorAll('.project-rename-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-project-id');
        const oldName = btn.getAttribute('data-project-name');
        const newName = prompt('Enter new project name:', oldName);
        if (newName && newName.trim() !== oldName) {
          const projectIndex = projects.findIndex(p => p.id === id);
          if (projectIndex !== -1) {
            projects[projectIndex].name = newName.trim();
            projects[projectIndex].lastModified = new Date().toISOString();
            saveProjects(projects);
            renderProjects(searchInput ? searchInput.value : '');
          }
        }
      });
    });
    
    document.querySelectorAll('.project-export-btn').forEach(btn => {
      btn.addEventListener('click', () => exportProject(btn.getAttribute('data-project-id')));
    });
    
    document.querySelectorAll('.project-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete this project?')) {
          const id = btn.getAttribute('data-project-id');
          projects = projects.filter(p => p.id !== id);
          saveProjects(projects);
          renderProjects(searchInput ? searchInput.value : '');
        }
      });
    });
  }

  function formatTime(dateStr) {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return 'unknown';
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  function createNewProject(e) {
    if (e) e.preventDefault();
    
    const projectName = projectNameInput ? projectNameInput.value.trim() : 'Untitled Project';
    if (!projectName) {
      alert('Please enter a project name');
      return;
    }
    
    // P2 item 13/10: the fallback blank project comes from the core
    // factory, like every other construction site — the hub keeps no
    // second literal. The blank scene keeps the hub's dark '#1e1e1e'
    // background, unlike the factory default.
    const newProject = window.HydraStarterTemplates?.createProject
      ? window.HydraStarterTemplates.createProject(selectedTemplateId, projectName, generateId)
      : window.HydraUniversal.createProject({
          id: generateId(),
          name: projectName,
          scenes: [window.HydraUniversal.createScene({ id: 1, name: 'Scene 1', bgColor: '#1e1e1e' })]
        });
    
    projects.push(newProject);
    saveProjects(projects);
    toggleWizard(false);
    openProject(newProject.id);
  }

  function importProject(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
      try {
        const projectData = normalizeProjectRecord(JSON.parse(event.target.result));
        if (!projectData?.id || !projectData?.name) throw new Error('Invalid project file');
        const existingIndex = projects.findIndex(p => p.id === projectData.id);
        if (existingIndex !== -1) {
          if (confirm(`Project "${projectData.name}" already exists. Overwrite?`)) {
            projects[existingIndex] = projectData;
          } else {
            projectData.id = generateId();
            projects.push(projectData);
          }
        } else {
          projects.push(projectData);
        }
        saveProjects(projects);
        renderProjects(searchInput ? searchInput.value : '');
        e.target.value = '';
      } catch (error) {
        alert('Failed to import project: ' + error.message);
      }
    };
    reader.readAsText(file);
  }

  function exportProject(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const clean = window.HydraUniversal?.serializeProject ? window.HydraUniversal.serializeProject(project) : project;
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(project.name)}.hydra`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAllProjects() {
    if (projects.length === 0) return alert('No projects to export');
    const cleanAll = window.HydraUniversal?.serializeProject ? projects.map(p => window.HydraUniversal.serializeProject(p)) : projects;
    const blob = new Blob([JSON.stringify(cleanAll, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hydra_projects_backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function openProject(projectId) {
    localStorage.setItem('currentProjectId', projectId);
    window.location.href = `index.html?v=${APP_CACHE_VERSION}`;
  }

  function generateId() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
});
