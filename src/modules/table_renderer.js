import { createTableEngine } from './table_engine.js';
import { formatCell as defaultFormatCell, parseInput as defaultParseInput } from './table_formatter.js';

function cellKey(rowId, colKey) {
  return `${rowId}:${colKey}`;
}

export function getRenderableCells(row, columns, cellSpanMap) {
  const cells = [];
  for (const column of columns) {
    const key = cellKey(row.rowId, column.columnKey);
    const span = cellSpanMap.get(key);
    if (span?.coveredBy) continue;
    cells.push({
      colKey: column.columnKey,
      span: span ?? { rowSpan: 1, colSpan: 1 }
    });
  }
  return cells;
}

function normalizeDataset(input = {}) {
  return {
    records: Array.isArray(input.records) ? input.records : [],
    merges: Array.isArray(input.merges) ? input.merges : []
  };
}

function updateDatasetWithPatch(dataset, patch) {
  return {
    ...dataset,
    records: dataset.records.map((record) => {
      if (record.id !== patch.recordId) return record;
      return {
        ...record,
        cells: { ...(record.cells ?? {}), ...(patch.cellsPatch ?? {}) },
        fmt: { ...(record.fmt ?? {}), ...(patch.fmtPatch ?? {}) }
      };
    })
  };
}

function applyColumnSettings(settings, nextColumns) {
  return {
    ...settings,
    columns: {
      ...(settings.columns ?? {}),
      ...nextColumns
    }
  };
}

function buildHeaderTitle(runtime) {
  const state = runtime?.sdo?.getState?.() ?? {};
  const journal = (state.journals ?? []).find((j) => j.id === state.activeJournalId);
  return journal ? `Таблиця: ${journal.title}` : 'Таблиця';
}

function getRuntimeState(runtime) {
  if (runtime?.api?.getState) return runtime.api.getState();
  if (runtime?.sdo?.api?.getState) return runtime.sdo.api.getState();
  return null;
}

function getJournalTemplatesApi(runtime) {
  return runtime?.api?.journalTemplates || runtime?.sdo?.api?.journalTemplates || runtime?.sdo?.journalTemplates;
}

async function ensureJournalTemplateId(runtime, state, journal, journalTemplatesApi) {
  let templateId = journal?.templateId;
  if (!journal || templateId || typeof journalTemplatesApi?.listTemplateEntities !== 'function') {
    return templateId;
  }

  const list = await journalTemplatesApi.listTemplateEntities();
  const defaultTplId = (list.find((t) => t.id === 'test')?.id) || (list[0]?.id) || null;
  if (!defaultTplId) return null;

  templateId = defaultTplId;
  if (typeof runtime?.sdo?.commit === 'function') {
    await runtime.sdo.commit((next) => {
      next.journals = (next.journals ?? []).map((item) => (
        item.id === journal.id ? { ...item, templateId: defaultTplId } : item
      ));
    }, ['journals_nodes_v2']);
  }

  return templateId;
}

async function ensureActiveJournal(runtime, state) {
  if (state?.activeJournalId || !state?.activeSpaceId || !Array.isArray(state?.journals) || state.journals.length === 0) {
    return state;
  }

  const candidate = state.journals.find((journal) => (
    journal.spaceId === state.activeSpaceId && journal.parentId === state.activeSpaceId
  ));
  if (!candidate || typeof runtime?.sdo?.commit !== 'function') return state;

  await runtime.sdo.commit((next) => {
    next.activeJournalId = candidate.id;
  }, ['nav_last_loc_v2']);

  return getRuntimeState(runtime);
}

export function createTableRendererModule(opts = {}) {
  const {
    // legacy/fallback single-dataset key (used only when tableStore module is not present)
    datasetKey = '@sdo/module-table-renderer:dataset',
    settingsKey = '@sdo/module-table-renderer:settings'
  } = opts;
  const initialSettings = {
    columns: { order: null, visibility: {}, widths: {} },
    sort: null,
    filter: { global: '' },
    expandedRowIds: [],
    selectedRowIds: []
  };

  let engine = null;
  let currentSchemaId = null;
  let selectionMode = false;

  function schemaFromTemplate(template) {
    const cols = Array.isArray(template?.columns) ? template.columns : [];
    return {
      id: template?.id ? `tpl:${template.id}` : 'tpl:__none__',
      fields: cols.map((c) => ({ key: c.key, label: c.label, type: 'text' }))
    };
  }

  async function resolveSchema(runtime) {
    const initialState = getRuntimeState(runtime);
    const state = await ensureActiveJournal(runtime, initialState);
    const journal = (state?.journals ?? []).find((item) => item.id === state?.activeJournalId);

    const journalTemplatesApi = getJournalTemplatesApi(runtime);
    if (!journalTemplatesApi?.getTemplate) {
      return { schema: { id: 'tpl:__none__', fields: [] }, journal, state };
    }

    const templateId = await ensureJournalTemplateId(runtime, state, journal, journalTemplatesApi);
    if (!templateId) {
      return { schema: { id: 'tpl:__none__', fields: [] }, journal, state };
    }

    const template = await journalTemplatesApi.getTemplate(templateId);
    return { schema: schemaFromTemplate(template), journal, state };
  }


  async function loadSettings(storage) {
    return { ...initialSettings, ...((await storage.get(settingsKey)) ?? {}) };
  }

  async function saveSettings(storage, settings) {
    await storage.set(settingsKey, settings);
  }

  async function loadDataset(runtime, storage, journalId) {
    const store = runtime?.api?.tableStore || runtime?.sdo?.api?.tableStore;
    if (store?.getDataset && journalId) {
      const ds = await store.getDataset(journalId);
      return normalizeDataset({ records: ds.records ?? [], merges: ds.merges ?? [] });
    }
    // fallback single-dataset storage
    return normalizeDataset((await storage.get(datasetKey)) ?? { records: [], merges: [] });
  }

  async function saveDataset(runtime, storage, journalId, dataset) {
    const store = runtime?.api?.tableStore || runtime?.sdo?.api?.tableStore;
    if (store?.upsertRecords && journalId) {
      // Replace records for now (renderer owns ordering)
      await store.upsertRecords(journalId, dataset.records ?? [], 'replace');
      return;
    }
    await storage.set(datasetKey, dataset);
  }

  function rerender(mount, runtime, renderFn) {
    mount.innerHTML = '';
    const cleanup = renderFn();
    if (typeof cleanup === 'function') return cleanup;
    return () => {};
  }

  function createModal() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,.35)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const modal = document.createElement('div');
    modal.style.background = '#fff';
    modal.style.padding = '12px';
    modal.style.borderRadius = '8px';
    modal.style.minWidth = '360px';

    overlay.append(modal);
    return { overlay, modal };
  }

  function columnSettingsUI(host, schema, settings, onChange) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.flexWrap = 'wrap';

    const schemaKeys = (schema && Array.isArray(schema.fields)) ? schema.fields.map((f) => f.key) : [];
    const ordered = (settings.columns && Array.isArray(settings.columns.order) && settings.columns.order.length)
      ? settings.columns.order
      : schemaKeys;

    for (const key of ordered) {
      const col = document.createElement('div');
      col.style.border = '1px solid #ddd';
      col.style.padding = '4px';

      const label = document.createElement('span');
      label.textContent = key;
      label.style.marginRight = '6px';

      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = settings.columns?.visibility?.[key] !== false;
      visible.addEventListener('change', () => {
        onChange(applyColumnSettings(settings, {
          visibility: { ...(settings.columns?.visibility ?? {}), [key]: visible.checked }
        }));
      });

      const widthInput = document.createElement('input');
      widthInput.type = 'number';
      widthInput.min = '40';
      widthInput.style.width = '72px';
      widthInput.value = settings.columns?.widths?.[key] ?? '';
      widthInput.addEventListener('change', () => {
        onChange(applyColumnSettings(settings, {
          widths: { ...(settings.columns?.widths ?? {}), [key]: Number(widthInput.value) || null }
        }));
      });

      const left = document.createElement('button');
      left.textContent = '←';
      left.addEventListener('click', () => {
        const idx = ordered.indexOf(key);
        if (idx <= 0) return;
        const nextOrder = [...ordered];
        [nextOrder[idx - 1], nextOrder[idx]] = [nextOrder[idx], nextOrder[idx - 1]];
        onChange(applyColumnSettings(settings, { order: nextOrder }));
      });

      const right = document.createElement('button');
      right.textContent = '→';
      right.addEventListener('click', () => {
        const idx = ordered.indexOf(key);
        if (idx < 0 || idx >= ordered.length - 1) return;
        const nextOrder = [...ordered];
        [nextOrder[idx], nextOrder[idx + 1]] = [nextOrder[idx + 1], nextOrder[idx]];
        onChange(applyColumnSettings(settings, { order: nextOrder }));
      });

      col.append(label, visible, widthInput, left, right);
      wrap.append(col);
    }

    host.append(wrap);
  }

  async function renderPanelFactory(mount, runtime) {
    let cleanup = () => {};

    const doRender = async () => {
      cleanup();
      cleanup = rerender(mount, runtime, () => {
        const container = document.createElement('div');
        const title = document.createElement('h4');
        title.textContent = buildHeaderTitle(runtime);

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '8px';

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Додати';

        const selectBtn = document.createElement('button');
        selectBtn.textContent = selectionMode ? 'Вибір: ON' : 'Вибір';

        const search = document.createElement('input');
        search.placeholder = 'Пошук';

        // Table must never cause horizontal scroll for the whole page.
        // Horizontal scroll is allowed ONLY inside the table module.
        const tableScroll = document.createElement('div');
        tableScroll.className = 'sdo-table-scroll';

        const table = document.createElement('table');
        table.className = 'sdo-table';
        // Fill the panel width by default; horizontal scroll stays inside tableScroll.
        // Column widths are controlled via <colgroup> so header/body always align.
        table.style.width = '100%';
        table.style.minWidth = '100%';
        table.style.borderCollapse = 'separate';
        table.style.borderSpacing = '0';
        tableScroll.append(table);

        const settingsBtn = document.createElement('button');
        settingsBtn.textContent = '⚙️ Колонки';

        const settingsHost = document.createElement('div');
        settingsHost.className = 'sdo-table-settings';
        settingsHost.style.display = 'none';

        container.className = 'sdo-table-panel';
        controls.className = 'sdo-table-controls';

        container.append(title, controls, tableScroll, settingsHost);

        // Settings shell button (current settings UI)
        const openSettingsShellBtn = document.createElement('button');
        openSettingsShellBtn.className = 'btn sdo-open-settings-shell';
        openSettingsShellBtn.textContent = 'Налаштування';
        openSettingsShellBtn.style.marginTop = '10px';
        openSettingsShellBtn.addEventListener('click', () => {
          try {
            if (window.UI?.settings?.openModal) window.UI.settings.openModal();
            else if (window.UI?.modal?.alert) window.UI.modal.alert('UI.settings.openModal недоступний');
            else alert('UI.settings.openModal недоступний');
          } catch (e) {
            console.error(e);
          }
        });
        container.append(openSettingsShellBtn);
        controls.append(addBtn, selectBtn, search, settingsBtn);
        mount.append(container);

        settingsBtn.addEventListener('click', () => {
          settingsHost.style.display = (settingsHost.style.display === 'none') ? 'block' : 'none';
        });

        const listeners = [];

        // current journal id for dataset operations
        let currentJournalId = null;

        const refreshTable = async () => {
          const settings = await loadSettings(runtime.storage);
          const resolved = await resolveSchema(runtime);
          const schema = resolved.schema;
          currentJournalId = resolved.state?.activeJournalId ?? null;
          const dataset = await loadDataset(runtime, runtime.storage, currentJournalId);
          if (!schema || !Array.isArray(schema.fields) || schema.fields.length === 0) {
            table.innerHTML = '';
            const msg = document.createElement('div');
            msg.style.padding = '8px';
            msg.style.color = '#666';
            msg.textContent = 'Немає колонок: журнал не має шаблону або шаблон не знайдено. Створіть журнал з шаблоном (наприклад, test).';
            table.append(msg);
            return;
          }

          // rebuild engine if schema changed
          if (!engine || currentSchemaId !== schema.id) {
            currentSchemaId = schema.id;
          }
          engine = createTableEngine({ schema, settings });
          engine.setDataset(dataset);
          const view = engine.compute();

          table.innerHTML = '';

          // One table:
          // - <thead> has 2 sticky rows (titles + column numbers)
          // - plus 2 fixed-width action columns on the far right (Transfer / Delete), like v1
          // - <colgroup> defines widths so header/body never drift.
          const colgroup = document.createElement('colgroup');
          const actionsColW = 44;
          const availableW = Math.max(320, tableScroll.getBoundingClientRect().width || 0);
          const nCols = view.columns.length;
          const baseW = Math.max(90, Math.floor((availableW - actionsColW * 2) / Math.max(1, nCols)));

          const thead = document.createElement('thead');
          const titleTr = document.createElement('tr');
          titleTr.className = 'sdo-hdr-title';
          const idxTr = document.createElement('tr');
          idxTr.className = 'sdo-hdr-idx';

          let colIdx = 0;
          for (const col of view.columns) {
            colIdx += 1;

            const w = col.width ? col.width : baseW;
            const colEl = document.createElement('col');
            colEl.style.width = `${w}px`;
            colEl.style.minWidth = `${w}px`;
            colgroup.append(colEl);

            const thTitle = document.createElement('th');
            thTitle.textContent = col.field?.label ?? col.columnKey;
            titleTr.append(thTitle);

            const thIdx = document.createElement('th');
            thIdx.className = 'sdo-col-idx';
            thIdx.textContent = String(colIdx);
            idxTr.append(thIdx);
          }

          const colTransfer = document.createElement('col');
          colTransfer.style.width = `${actionsColW}px`;
          colTransfer.style.minWidth = `${actionsColW}px`;
          const colDelete = document.createElement('col');
          colDelete.style.width = `${actionsColW}px`;
          colDelete.style.minWidth = `${actionsColW}px`;
          colgroup.append(colTransfer, colDelete);

          const thTransfer = document.createElement('th');
          thTransfer.className = 'sdo-col-actions';
          thTransfer.rowSpan = 2;
          thTransfer.title = 'Перенести';
          thTransfer.textContent = '⇄';

          const thDelete = document.createElement('th');
          thDelete.className = 'sdo-col-actions';
          thDelete.rowSpan = 2;
          thDelete.title = 'Видалити';
          thDelete.textContent = '🗑';

          titleTr.append(thTransfer, thDelete);

          thead.append(titleTr, idxTr);
          table.append(colgroup);
          table.append(thead);

          // Measure the 1st header row height and set CSS var so the 2nd row can sticky under it.
          // (Needed because row height can change with theme/font/2-line labels.)
          const syncHeaderHeights = () => {
            const h = titleTr.getBoundingClientRect().height;
            table.style.setProperty('--sdo-thead-row1-h', `${Math.ceil(h)}px`);
          };
          requestAnimationFrame(syncHeaderHeights);
          window.addEventListener('resize', syncHeaderHeights);

          const tbody = document.createElement('tbody');
          table.append(tbody);

          for (const row of view.rows) {
            const tr = document.createElement('tr');

            const renderableCells = getRenderableCells(row, view.columns, view.cellSpanMap);
            for (const cell of renderableCells) {
              const td = document.createElement('td');
              const span = cell.span;
              if (span.rowSpan) td.rowSpan = span.rowSpan;
              if (span.colSpan) td.colSpan = span.colSpan;

              const formatted = defaultFormatCell(row.record.cells?.[cell.colKey], row.record.fmt?.[cell.colKey] ?? {}, schema.fields.find((f) => f.key === cell.colKey) ?? {}, { locale: 'uk-UA', dateFormat: 'DD.MM.YYYY' });
              const firstColKey = view.columns[0]?.columnKey;
              const isFirstCol = cell.colKey === firstColKey;

// Render normal cell text by default.
td.textContent = formatted.text;

// Indentation only for the first (tree) column (do not change padding for other columns -> keeps header/body aligned).
if (isFirstCol) {
  td.style.paddingLeft = `${row.depth * 16 + 8}px`;
}

              // Actions are rendered as their own fixed-width columns at the far right (see below).

              if (formatted.align) td.style.textAlign = formatted.align;
              if (formatted.style) Object.assign(td.style, formatted.style);

              if (cell.colKey === view.columns[0]?.columnKey && row.hasChildren) {
                const expander = document.createElement('button');
                expander.textContent = row.isExpanded ? '▾' : '▸';
                expander.style.marginRight = '4px';
                expander.addEventListener('click', async (ev) => {
                  ev.stopPropagation();
                  engine.toggleExpand(row.rowId);
                  const next = { ...settings, expandedRowIds: [...engine.compute().rows.filter((r) => r.isExpanded).map((r) => r.rowId)] };
                  await saveSettings(runtime.storage, next);
                  await refreshTable();
                });
                td.prepend(expander);
              }

              td.addEventListener('click', () => {
                const spanInfo = view.cellSpanMap.get(cellKey(row.rowId, cell.colKey));
                if (spanInfo?.coveredBy) return;
                engine.beginEdit(row.rowId, cell.colKey);
                const inputModel = formatted.editor ?? { type: 'text', props: {} };
                const input = document.createElement('input');
                input.type = inputModel.type === 'number' ? 'number' : inputModel.type === 'date' ? 'date' : 'text';
                input.value = row.record.cells?.[cell.colKey] ?? '';
                td.innerHTML = '';
                td.append(input);
                input.focus();

                const save = async () => {
                  const parsed = defaultParseInput(input.value, schema.fields.find((f) => f.key === cell.colKey) ?? {});
                  const patch = engine.applyEdit(row.rowId, cell.colKey, parsed.v);
                  const currentDataset = await loadDataset(runtime, runtime.storage, currentJournalId);
                  const nextDataset = updateDatasetWithPatch(currentDataset, patch);
                  await saveDataset(runtime, runtime.storage, currentJournalId, nextDataset);
                  await refreshTable();
                };

                input.addEventListener('keydown', async (ev) => {
                  if (ev.key === 'Enter') await save();
                  if (ev.key === 'Escape') {
                    engine.cancelEdit();
                    await refreshTable();
                  }
                });
                input.addEventListener('blur', save, { once: true });
              });

              tr.append(td);
            }

            // Fixed action columns at far right (Transfer / Delete)
            {
              const tdTransfer = document.createElement('td');
              tdTransfer.className = 'sdo-col-actions';
              const transferBtn = document.createElement('button');
              transferBtn.className = 'sdo-row-transfer';
              transferBtn.textContent = '⇄';
              transferBtn.title = 'Перенести рядок';
              transferBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                runtime.sdo.commands.run('table.transferRow', { rowId: row.rowId });
              });
              tdTransfer.append(transferBtn);
              tr.append(tdTransfer);

              const tdDelete = document.createElement('td');
              tdDelete.className = 'sdo-col-actions';
              const deleteBtn = document.createElement('button');
              deleteBtn.className = 'sdo-row-delete';
              deleteBtn.textContent = '🗑';
              deleteBtn.title = 'Видалити рядок';
              deleteBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const ok = await UI.modal.confirm('Видалити цей рядок?');
                if (!ok) return;
                const currentDataset = await loadDataset(runtime, runtime.storage, currentJournalId);
                const nextDataset = { ...currentDataset, records: (currentDataset.records ?? []).filter((r) => r.id !== row.rowId) };
                await saveDataset(runtime, runtime.storage, currentJournalId, nextDataset);
                await refreshTable();
              });
              tdDelete.append(deleteBtn);
              tr.append(tdDelete);
            }

            if (selectionMode) {
              tr.style.cursor = 'pointer';
              tr.addEventListener('click', async () => {
                engine.toggleSelect(row.rowId);
                const next = { ...settings, selectedRowIds: [...engine.compute().selection] };
                await saveSettings(runtime.storage, next);
                await refreshTable();
              });
            }

            tbody.append(tr);
          }
        };

        addBtn.addEventListener('click', async () => {
          if (!engine) {
            await refreshTable();
            return;
          }
          const modal = createModal();
          const model = engine.getAddFormModel();
          const form = document.createElement('form');
          const values = {};

          for (const field of model) {
            const label = document.createElement('label');
            label.textContent = field.label;
            label.style.display = 'block';
            const input = document.createElement('input');
            input.type = field.type === 'number' ? 'number' : 'text';
            input.value = field.default ?? '';
            input.addEventListener('change', () => { values[field.key] = input.value; });
            label.append(input);
            form.append(label);
          }

          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.textContent = 'Додати';
          form.append(submit);

          form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const validation = engine.validateAddForm(values);
            if (!validation.valid) return;
            const record = engine.buildRecordFromForm(values);
            const dataset = await loadDataset(runtime, runtime.storage, currentJournalId);
            const nextDataset = { ...dataset, records: [...dataset.records, record] };
            await saveDataset(runtime, runtime.storage, currentJournalId, nextDataset);
            document.body.removeChild(modal.overlay);
            await refreshTable();
          });

          modal.modal.append(form);
          document.body.append(modal.overlay);
        });

        selectBtn.addEventListener('click', async () => {
          selectionMode = !selectionMode;
          await refreshTable();
        });

        search.addEventListener('change', async () => {
          const settings = await loadSettings(runtime.storage);
          const next = { ...settings, filter: { ...(settings.filter ?? {}), global: search.value ?? '' } };
          await saveSettings(runtime.storage, next);
          await refreshTable();
        });
        settingsHost.style.marginTop = '8px';
        Promise.all([loadSettings(runtime.storage), resolveSchema(runtime)]).then(([settings, resolved]) => {
          columnSettingsUI(settingsHost, resolved.schema, settings, async (next) => {
            await saveSettings(runtime.storage, next);
            await refreshTable();
          });
        });

        refreshTable();

        return () => {
          for (const [el, type, fn] of listeners) el.removeEventListener(type, fn);
        };
      });
    };

    doRender();
    const off = runtime.sdo.on('state:changed', doRender);
    return () => {
      off?.();
      cleanup?.();
    };
  }

  return {
    id: '@sdo/module-table-renderer',
    version: '1.0.0',
    init(ctx) {
      ctx.registerCommands([
        {
          id: '@sdo/module-table-renderer.refresh',
          title: 'Refresh table renderer',
          run: async () => true
        },
        {
          id: '@sdo/module-table-renderer.toggle-selection-mode',
          title: 'Toggle table selection mode',
          run: async () => { selectionMode = !selectionMode; }
        },
        {
          id: 'table.transferRow',
          title: 'Transfer row',
          run: async () => true
        }
      ]);

      ctx.ui.registerButton({
        id: '@sdo/module-table-renderer:add-row',
        label: '+ Додати',
        location: 'toolbar',
        order: 30,
        onClick: () => ctx.commands.run('@sdo/module-table-renderer.refresh')
      });

      ctx.ui.registerButton({
        id: '@sdo/module-table-renderer:selection',
        label: 'Вибір',
        location: 'toolbar',
        order: 31,
        onClick: () => ctx.commands.run('@sdo/module-table-renderer.toggle-selection-mode')
      });

      ctx.ui.registerPanel({
        id: '@sdo/module-table-renderer:panel',
        title: 'Table',
        location: 'main',
        order: 5,
        render: (mount, runtime) => {
          if (typeof document === 'undefined') return () => {};
          if (!runtime?.storage) runtime.storage = ctx.storage;
          if (!runtime?.sdo) runtime.sdo = runtime?.api?.sdo;
          return renderPanelFactory(mount, runtime);
        }
      });
    }
  };
}
