const module = {
  id: 'module-example-table',
  version: '1.0.0',
  init(ctx) {
    const SETTINGS_KEY = 'module-example-table:settings';
    const USER_DATA_KEY = 'module-example-table:userData';
    const REV_KEY = 'module-example-table:revision';
    const CHANGELOG_KEY = 'module-example-table:changelog';

    ctx.registerSchema({
      id: 'module-example-table.records',
      version: '1.0.0',
      domain: 'table',
      appliesTo: { templateId: 'table-template-v1' },
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'amount', label: 'Amount', type: 'money', required: true, default: 0 },
        { key: 'postedAt', label: 'Posted At', type: 'date' }
      ],
      formats: [{ id: 'money.uah', type: 'currency' }],
      validators: [{ id: 'amount.nonNegative' }]
    });

    ctx.registerSettings({
      id: 'module-example-table.settings',
      tab: { id: 'table', title: 'Table', order: 10 },
      fields: [
        {
          key: 'module-example-table:settings.viewMode',
          label: 'View mode',
          type: 'text',
          default: 'table',
          read: async () => ((await ctx.storage.get(SETTINGS_KEY)) ?? {}).viewMode ?? 'table',
          write: async (_runtime, value) => {
            const next = { ...((await ctx.storage.get(SETTINGS_KEY)) ?? {}), viewMode: value };
            await ctx.storage.set(SETTINGS_KEY, next);
          }
        },
        {
          key: 'module-example-table:settings.formatting',
          label: 'Formatting',
          type: 'text',
          default: 'short',
          read: async () => ((await ctx.storage.get(SETTINGS_KEY)) ?? {}).formatting ?? 'short',
          write: async (_runtime, value) => {
            const next = { ...((await ctx.storage.get(SETTINGS_KEY)) ?? {}), formatting: value };
            await ctx.storage.set(SETTINGS_KEY, next);
          }
        }
      ]
    });

    ctx.registerCommands([
      {
        id: 'module-example-table.export-json',
        title: 'Export JSON',
        group: 'file',
        menu: { location: 'toolbar', path: ['File'] },
        order: 10,
        run: async () => {
          const rows = (await ctx.storage.get(USER_DATA_KEY)) ?? [];
          alert(JSON.stringify(rows));
        }
      },
      {
        id: 'module-example-table.clear',
        title: 'Clear records',
        group: 'edit',
        menu: { location: 'toolbar', path: ['Edit'] },
        order: 20,
        confirm: { message: 'Clear all records?', requireDigit: true },
        run: async () => {
          await ctx.storage.set(USER_DATA_KEY, []);
          await appendChange({}, [USER_DATA_KEY]);
        }
      }
    ]);

    ctx.ui.registerButton({
      id: 'module-example-table.export',
      label: 'Export JSON',
      location: 'toolbar',
      order: 5,
      onClick: () => ctx.commands.run('module-example-table.export-json')
    });

    ctx.backup.registerProvider({
      id: 'module-example-table',
      version: '1.0.0',
      describe: () => ({ settings: [SETTINGS_KEY], userData: [USER_DATA_KEY] }),
      export: async (opts) => {
        const payload = {
          settings: (await ctx.storage.get(SETTINGS_KEY)) ?? {},
          revision: (await ctx.storage.get(REV_KEY)) ?? 0
        };
        if (opts.includeUserData) payload.userData = (await ctx.storage.get(USER_DATA_KEY)) ?? [];
        return payload;
      },
      import: async (payload, opts) => {
        await ctx.storage.set(SETTINGS_KEY, payload.settings ?? {});
        if (opts.includeUserData && Array.isArray(payload.userData)) {
          if (opts.mode === 'replace') {
            await ctx.storage.set(USER_DATA_KEY, payload.userData);
          } else {
            const current = (await ctx.storage.get(USER_DATA_KEY)) ?? [];
            await ctx.storage.set(USER_DATA_KEY, [...current, ...payload.userData]);
          }
        }
        return { applied: true, warnings: [] };
      }
    });

    async function appendChange(set = {}, del = []) {
      const rev = ((await ctx.storage.get(REV_KEY)) ?? 0) + 1;
      await ctx.storage.set(REV_KEY, rev);
      const log = (await ctx.storage.get(CHANGELOG_KEY)) ?? [];
      log.push({ revision: rev, set, del, at: new Date().toISOString() });
      await ctx.storage.set(CHANGELOG_KEY, log.slice(-200));
      return rev;
    }

    module.exportDelta = async (sinceRevision = 0) => {
      const log = (await ctx.storage.get(CHANGELOG_KEY)) ?? [];
      const changes = log.filter((x) => x.revision > sinceRevision);
      return {
        revision: (await ctx.storage.get(REV_KEY)) ?? 0,
        set: Object.assign({}, ...changes.map((x) => x.set ?? {})),
        del: changes.flatMap((x) => x.del ?? [])
      };
    };

    module.applyDelta = async (patch) => {
      for (const [key, value] of Object.entries(patch.set ?? {})) await ctx.storage.set(key, value);
      for (const key of patch.del ?? []) await ctx.storage.del(key);
      await appendChange(patch.set, patch.del);
      return { applied: true, warnings: [] };
    };
  }
};

export default module;
export { module };
