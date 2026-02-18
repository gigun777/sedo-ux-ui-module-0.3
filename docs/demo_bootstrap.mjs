const BOOT_KEY = '__sdoDemoBootstrapped';

if (globalThis[BOOT_KEY]) {
  console.warn('SDO demo bootstrap skipped: already initialized');
} else {
  globalThis[BOOT_KEY] = true;

  const cacheTag = 'v=20260215c';
  const sdoCore = await import(`../dist/index.js?${cacheTag}`);
  const { createModuleManagerUI } = await import(`../dist/ui/ui_core.js?${cacheTag}`);
  const { default: tableModule } = await import('./reference-module.mjs');

  const createTableStoreModule = sdoCore.createTableStoreModule;
  const createTableRendererModule = sdoCore.createTableRendererModule;

  const modules = [tableModule];
  if (typeof createTableStoreModule === 'function') modules.push(createTableStoreModule());
  if (typeof createTableRendererModule === 'function') {
    modules.push(createTableRendererModule({ schema: { id: 'fallback', fields: [] } }));
  } else {
    console.warn('createTableRendererModule export is missing in ./dist/index.js; load fresh dist build');
  }

  const appNode = document.getElementById('app');
  const sdo = sdoCore['createSEDO']({
    storage: sdoCore['createMemoryStorage'](),
    mount: appNode,
    createUI: createModuleManagerUI,
    modules
  });

  await sdo.start();
  window.sdo = sdo;
}
