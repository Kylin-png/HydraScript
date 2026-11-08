// Project data structure management
document.addEventListener('DOMContentLoaded', function() {
  const APP_CACHE_VERSION = '20260811-fixed1';
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
    try {
      const storedProjects = localStorage.getItem('hydraProjects');
      const parsed = storedProjects ? JSON.parse(storedProjects) : [];
      return Array.isArray(parsed) ? parsed.map(normalizeProjectRecord).filter(Boolean) : [];
    } catch (error) {
      console.error('Error loading projects:', error);
      return [];
    }
  }

  function saveProjects(projects) {
    try {
      localStorage.setItem('hydraProjects', JSON.stringify(projects));
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
              <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors project-rename-btn" title="Rename" data-project-id="${project.id}" data-project-name="${escapedName}">
                <span class="material-icons text-lg">edit</span>
              </button>
              <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors project-export-btn" title="Backup" data-project-id="${project.id}">
                <span class="material-icons text-lg">download</span>
              </button>
              <button class="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors project-delete-btn" title="Delete" data-project-id="${project.id}">
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
    
    const newProject = window.HydraStarterTemplates?.createProject
      ? window.HydraStarterTemplates.createProject(selectedTemplateId, projectName, generateId)
      : {
          id: generateId(),
          name: projectName,
          dateCreated: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          eventsVersion: 1,
          globalGridData: {},
          logicGrids: { global: {} },
          eventSheets: [],
          sceneCount: 1,
          scenes: [{
            id: 1,
            name: 'Scene 1',
            objects: [],
            entities: [],
            bgColor: '#1e1e1e',
            bgAssetId: null,
            width: 800,
            height: 600,
            worldWidth: 800,
            worldHeight: 600,
            viewportWidth: 800,
            viewportHeight: 600,
            gridData: {},
            logicGrids: { main: {} },
            eventSheets: []
          }],
          currentSceneId: 1,
          nextSceneId: 2,
          activeScriptScope: 'global',
          assets: {}
        };
    
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
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(project.name)}.hydra`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAllProjects() {
    if (projects.length === 0) return alert('No projects to export');
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
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
