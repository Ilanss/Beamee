const ROUTES = {
  library: {
    title: 'Beamee',
    html: '../views/library.html',
    module: './renderer.js',
  },
  settings: {
    title: 'Preferences',
    html: '../views/settings.html',
    module: './preferences.js',
  },
};

let activeRouteName = null;
let activeModule = null;
let activeLoadToken = 0;
let activeSession = null;
const moduleCache = new Map();

const getRoot = () => document.getElementById('view-root');

const normalizeRoute = (value) => {
  if (typeof value !== 'string') {
    return 'library';
  }

  const route = value.trim().replace(/^#/, '').replace(/^\//, '');
  return ROUTES[route] ? route : 'library';
};

const resolveAssetPath = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  return decodeURIComponent(url.pathname);
};

const readHtml = (relativePath) => {
  const filePath = resolveAssetPath(relativePath);
  return window.fs.readFileSync(filePath, 'utf8');
};

const loadModule = async (relativePath) => {
  if (!moduleCache.has(relativePath)) {
    const modulePromise = import(new URL(relativePath, import.meta.url)).catch((error) => {
      moduleCache.delete(relativePath);
      throw error;
    });

    moduleCache.set(relativePath, modulePromise);
  }

  return moduleCache.get(relativePath);
};

const cleanupActiveModule = async () => {
  if (activeModule && typeof activeModule.unmount === 'function') {
    await activeModule.unmount();
  }

  activeModule = null;
};

const createSession = () => {
  const session = {
    id: ++activeLoadToken,
    cancelled: false,
    isCurrent: () => !session.cancelled && activeSession?.id === session.id,
    cancel: () => {
      session.cancelled = true;
    },
  };

  activeSession = session;
  return session;
};

const renderRoute = async (routeName) => {
  const route = ROUTES[routeName] || ROUTES.library;
  const root = getRoot();

  if (!root) {
    return;
  }

  if (routeName === activeRouteName && activeModule) {
    return;
  }

  const session = createSession();

  await cleanupActiveModule();
  if (!session.isCurrent()) {
    return;
  }

  root.innerHTML = readHtml(route.html);
  if (!session.isCurrent()) {
    return;
  }

  const importedModule = await loadModule(route.module);

  if (!session.isCurrent()) {
    return;
  }

  activeModule = importedModule;
  activeRouteName = routeName;
  document.title = route.title;
  document.body.dataset.route = routeName;

  if (typeof importedModule.mount === 'function') {
    await importedModule.mount(root, {
      routeName,
      navigate,
      isCurrent: session.isCurrent,
    });
  }
};

function navigate(routeName, options = {}) {
  const nextRoute = ROUTES[routeName] ? routeName : 'library';
  const nextHash = `#${nextRoute}`;

  if (options.replace) {
    window.history.replaceState(null, '', nextHash);
    return renderRoute(nextRoute);
  }

  if (window.location.hash === nextHash) {
    return renderRoute(nextRoute);
  }

  window.location.hash = nextHash;
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-route]');

  if (!trigger) {
    return;
  }

  const routeName = trigger.dataset.route;

  if (!routeName) {
    return;
  }

  event.preventDefault();
  navigate(routeName);
});

window.addEventListener('hashchange', () => {
  const routeName = normalizeRoute(window.location.hash);
  renderRoute(routeName);
});

if (window.ipcRenderer && typeof window.ipcRenderer.on === 'function') {
  window.ipcRenderer.on('navigate', (routeName) => {
    navigate(routeName);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash) {
    navigate('library', { replace: true });
    return;
  }

  renderRoute(normalizeRoute(window.location.hash));
});

window.beameeRouter = {
  navigate,
  getCurrentRoute: () => activeRouteName,
};
