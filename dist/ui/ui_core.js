import { canGoBackJournal, canGoBackSpace } from '../core/navigation_core.js';
import { h } from './ui_primitives.js';
import { createModalManager } from './ui_modal.js';
import './theme.js';
import './ui_manager.js';
import './ui_backup.js';
import './ui_toast.js';
import './settings/settings_registry.js';
import './settings/settings_state.js';
import './settings/features_table_settings.js';
import './settings/features_uxui_settings.js';
import './settings/features_backup_settings.js';
import './settings/settings_init.js';
import './settings/settings_shell_modal.js';

function findById(items, id) {
  return items.find((item) => item.id === id) ?? null;
}

export function createModuleManagerUI({ sdo, mount, api }) {
  if (!mount) return null;

  function setStatus(message) {
    if (window.UI?.toast?.show) {
      window.UI.toast.show(message, { type: 'info' });
    }
  }
  const navigationHost = h('div', { class: 'sdo-navigation' });
  const toolbar = h('div', { class: 'sdo-toolbar' });
  const panelsHost = h('div', { class: 'sdo-panels' });
  const settingsHost = h('div', { class: 'sdo-settings' });
  const modalLayer = h('div', { class: 'sdo-modal-layer' });
  const modal = createModalManager(modalLayer);

  function ensureGlobalUIBridge() {
    const UI = (window.UI = window.UI || {});
    UI.settings = UI.settings || {};

    if (!UI.modal || typeof UI.modal.open !== 'function' || typeof UI.modal.close !== 'function') {
      let modalSeq = 0;
      const modalStack = [];

      function closeModalRecord(record) {
        if (!record) return;
        record.cleanup?.();
        record.overlay.remove();
        const idx = modalStack.findIndex((item) => item.id === record.id);
        if (idx >= 0) modalStack.splice(idx, 1);
        try { record.onClose?.(); } catch (_) {}
      }

      function getTopRecord() {
        return modalStack[modalStack.length - 1] || null;
      }

      UI.modal = {
        open(options = {}) {
          modalSeq += 1;
          const modalId = String(modalSeq);

          const overlay = document.createElement('div');
          overlay.className = 'sdo-ui-modal-overlay ui-modal';
          overlay.dataset.modalId = modalId;

          const windowNode = document.createElement('div');
          windowNode.className = 'sdo-ui-modal-window';

          const wrapper = h('div', { class: 'ui-modal-content' });
          if (options.title) {
            wrapper.append(h('h3', { class: 'ui-modal-title' }, [options.title]));
          }
          if (options.contentNode) wrapper.append(options.contentNode);
          else if (options.html) {
            const htmlHost = h('div', { class: 'ui-modal-html' });
            htmlHost.innerHTML = options.html;
            wrapper.append(htmlHost);
          }

          windowNode.append(wrapper);
          overlay.append(windowNode);
          document.body.appendChild(overlay);

          const onKeydown = (event) => {
            if (event.key !== 'Escape') return;
            if (options.escClose === false) return;
            const top = getTopRecord();
            if (top?.id !== modalId) return;
            event.preventDefault();
            this.close(modalId);
          };

          const onOverlayMouseDown = (event) => {
            if (options.closeOnOverlay === false) return;
            if (event.target !== overlay) return;
            const top = getTopRecord();
            if (top?.id !== modalId) return;
            this.close(modalId);
          };

          document.addEventListener('keydown', onKeydown);
          overlay.addEventListener('mousedown', onOverlayMouseDown);

          const record = {
            id: modalId,
            overlay,
            onClose: typeof options.onClose === 'function' ? options.onClose : null,
            cleanup() {
              document.removeEventListener('keydown', onKeydown);
              overlay.removeEventListener('mousedown', onOverlayMouseDown);
            }
          };

          modalStack.push(record);
          return modalId;
        },
        close(modalId) {
          if (modalId) {
            const target = modalStack.find((item) => item.id === String(modalId));
            closeModalRecord(target);
            return;
          }
          closeModalRecord(getTopRecord());
        },
        alert(text, opts = {}) {
          const node = h('div', { class: 'ui-modal-content' }, [h('p', {}, [String(text || '')])]);
          return this.open({ title: opts.title || 'Увага', contentNode: node, onClose: opts.onClose });
        },
        async confirm(text, opts = {}) {
          return new Promise((resolve) => {
            let settled = false;
            const finalize = (value) => {
              if (settled) return;
              settled = true;
              resolve(value);
            };

            const content = h('div', { class: 'ui-modal-content' }, [
              h('p', {}, [String(text || opts.title || 'Підтвердити дію?')])
            ]);
            const actions = h('div', { class: 'ui-modal-footer' }, [
              h('button', {
                class: 'btn',
                onClick: () => {
                  UI.modal.close(modalId);
                  finalize(false);
                }
              }, [opts.cancelText || 'Скасувати']),
              h('button', {
                class: 'btn btn-primary',
                onClick: () => {
                  UI.modal.close(modalId);
                  finalize(true);
                }
              }, [opts.okText || 'Підтвердити'])
            ]);
            content.append(actions);

            const modalId = UI.modal.open({
              title: opts.title || 'Підтвердження',
              contentNode: content,
              closeOnOverlay: false,
              onClose: () => finalize(false)
            });
          });
        }
      };
    }

    if (!UI.toast || typeof UI.toast.show !== 'function') {
      UI.toast = {
        show(message) {
          console.info('[UI.toast]', message);
        }
      };
    }
  }

  ensureGlobalUIBridge();

  const addModuleButton = h('button', {
    class: 'sdo-add-module',
    onClick: async () => {
      const url = window.prompt('Module ESM URL:');
      if (!url) return;
      try {
        await sdo.loadModuleFromUrl(url);
        setStatus(`Module loaded: ${url}`);
      } catch (error) {
        setStatus(`Load failed: ${error.message}`);
      }
    }
  }, ['+ Додати модуль']);

  const templatesButton = h('button', {
    class: 'sdo-add-module',
    onClick: () => openTemplatesManager()
  }, ['Шаблони']);

  const settingsButton = h('button', {
    class: 'sdo-add-module',
    onClick: () => openSettingsModal()
  }, ['Налаштування']);

  function closeModal() { modal.close(); }

  function openPicker({ title, items, onSelect, onAddCurrentLevel, getLabel }) {
    const list = h('div', { class: 'sdo-picker-list' });
    for (const item of items) {
      const row = h('button', {
        class: 'sdo-picker-row',
        onClick: async () => {
          await onSelect(item);
          closeModal();
        }
      }, [getLabel(item)]);
      list.append(row);
    }

    const modalChildren = [
      h('div', { class: 'sdo-picker-title' }, [title]),
      list
    ];

    if (typeof onAddCurrentLevel === 'function') {
      modalChildren.push(h('button', {
        class: 'sdo-picker-add',
        onClick: async () => {
          await onAddCurrentLevel();
          closeModal();
        }
      }, ['+ Додати на цей рівень']));
    }

    modalChildren.push(h('button', { class: 'sdo-picker-close', onClick: closeModal }, ['Закрити']));
    modal.open(h('div', { class: 'sdo-picker-modal' }, modalChildren), { closeOnOverlay: true });
  }

  async function openTemplatesManager() {
    let selectedId = null;
    let deleteArmed = false;

    const title = h('div', { class: 'sdo-picker-title' }, ['Шаблони журналів']);
    const listHost = h('div', { class: 'sdo-picker-list' });
    const detailsHost = h('div', { class: 'sdo-template-details' }, ['Оберіть шаблон']);
    const actions = h('div', { class: 'sdo-template-actions' });

    async function refresh() {
      const templates = await sdo.journalTemplates.listTemplateEntities();
      if (!selectedId && templates[0]) selectedId = templates[0].id;
      if (selectedId && !templates.some((t) => t.id === selectedId)) selectedId = templates[0]?.id ?? null;

      listHost.innerHTML = '';
      for (const tpl of templates) {
        listHost.append(h('button', {
          class: `sdo-picker-row ${tpl.id === selectedId ? 'is-selected' : ''}`,
          onClick: () => {
            selectedId = tpl.id;
            deleteArmed = false;
            refresh();
          }
        }, [`${tpl.title} (${tpl.columns.length})`]));
      }

      const selected = templates.find((x) => x.id === selectedId) ?? null;
      if (!selected) {
        detailsHost.innerHTML = 'Немає шаблонів';
      } else {
        detailsHost.innerHTML = '';
        detailsHost.append(h('div', { class: 'sdo-template-title' }, [`ID: ${selected.id}`]));
        for (const col of selected.columns) {
          detailsHost.append(h('div', { class: 'sdo-template-col' }, [`• ${col.label} (${col.key})`]));
        }
      }

      actions.innerHTML = '';
      actions.append(
        h('button', {
          class: 'sdo-picker-add',
          onClick: async () => {
            const id = window.prompt('ID шаблону (без пробілів):', 'new-template');
            if (!id) return;
            const titleValue = window.prompt('Назва шаблону:', id) ?? id;
            const colsRaw = window.prompt('Назви колонок через кому:', '1,2,3');
            if (!colsRaw) return;
            const labels = colsRaw.split(',').map((x) => x.trim()).filter(Boolean);
            await sdo.journalTemplates.addTemplate({
              id,
              title: titleValue,
              columns: labels.map((label, idx) => ({ key: `c${idx + 1}`, label }))
            });
            selectedId = id;
            deleteArmed = false;
            await refresh();
          }
        }, ['Додати шаблон']),
        h('button', {
          class: 'sdo-picker-close',
          onClick: async () => {
            if (!selectedId) return;
            if (!deleteArmed) {
              deleteArmed = true;
              await refresh();
              return;
            }
            await sdo.journalTemplates.deleteTemplate(selectedId);
            selectedId = null;
            deleteArmed = false;
            await refresh();
          }
        }, [deleteArmed ? 'Так, видалити' : 'Видалити шаблон']),
        h('button', {
          class: 'sdo-picker-close',
          onClick: () => {
            deleteArmed = false;
            closeModal();
          }
        }, [deleteArmed ? 'Ні' : 'Закрити'])
      );
    }

    const modalEl = h('div', { class: 'sdo-picker-modal' }, [title, listHost, detailsHost, actions]);
    modal.open(modalEl, { closeOnOverlay: true });
    await refresh();
  }

  function openSettingsModal() {
    // Legacy table-specific settings modal was removed in favor of Patch 4 global shell.
    if (typeof window !== 'undefined' && window.UI?.settings?.openModal) {
      window.UI.settings.init?.();
      window.UI.settings.openModal({
        initialFeature: 'table',
        initialSection: 'journals'
      });
      return;
    }

    const message = 'UI.settings.openModal недоступний: перевірте порядок підключення settings-модулів.';
    if (window.UI?.toast?.show) {
      window.UI.toast.show(message, { type: 'error' });
    } else {
      window.alert(message);
    }
  }

  function evaluateGuard(fn, fallback = true) {
    if (typeof fn !== 'function') return fallback;
    return Boolean(fn({ api, sdo }));
  }

  async function ensureRootSpace() {
    const state = sdo.getState();
    if (state.spaces.length > 0) return;
    await sdo.commit((next) => {
      const rootId = crypto.randomUUID();
      next.spaces = [{ id: rootId, title: 'Простір 1', parentId: null, childCount: 0 }];
      next.activeSpaceId = rootId;
      next.activeJournalId = null;
    }, ['spaces_nodes_v2', 'nav_last_loc_v2']);
  }

  function getJournalLabel(journal) {
    const idx = journal.index ? `${journal.index} ` : '';
    return `${idx}${journal.title}`;
  }

  async function createJournalWithTemplate({ state, parentId, titlePrompt }) {
    const templates = await sdo.journalTemplates.listTemplateEntities();
    if (templates.length === 0) {
      setStatus('Немає доступних шаблонів');
      return;
    }
    openPicker({
      title: 'Оберіть шаблон журналу',
      items: templates,
      getLabel: (tpl) => tpl.title,
      onSelect: async (template) => {
        const title = window.prompt('Назва журналу:', titlePrompt);
        if (!title) return;
        await sdo.commit((next) => {
          const node = {
            id: crypto.randomUUID(),
            spaceId: state.activeSpaceId,
            parentId,
            templateId: template.id,
            title,
            childCount: 0
          };
          next.journals = [...next.journals, node];
          next.activeJournalId = node.id;
        }, ['journals_nodes_v2', 'nav_last_loc_v2']);
      }
    });
  }

  async function renderNavigation() {
    await ensureRootSpace();
    const state = sdo.getState();
    const activeSpace = findById(state.spaces, state.activeSpaceId);
    const activeJournal = findById(state.journals, state.activeJournalId);

    const spaceSiblings = state.spaces.filter((x) => x.parentId === (activeSpace?.parentId ?? null));
    const spaceChildren = state.spaces.filter((x) => x.parentId === activeSpace?.id);

    const journalSiblings = activeJournal
      ? state.journals.filter((j) => j.spaceId === state.activeSpaceId && j.parentId === activeJournal.parentId)
      : state.journals.filter((j) => j.spaceId === state.activeSpaceId && j.parentId === state.activeSpaceId);
    const journalChildren = activeJournal
      ? state.journals.filter((j) => j.spaceId === state.activeSpaceId && j.parentId === activeJournal.id)
      : [];

    const spaceBackBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-back',
      disabled: canGoBackSpace(activeSpace) ? null : 'disabled',
      onClick: async () => {
        if (!activeSpace?.parentId) return;
        await sdo.commit((next) => {
          next.activeSpaceId = activeSpace.parentId;
          next.activeJournalId = null;
        }, ['nav_last_loc_v2']);
      }
    }, ['←']);

    const spaceCurrentBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main',
      onClick: () => openPicker({
        title: 'Оберіть простір поточного рівня',
        items: spaceSiblings,
        getLabel: (item) => item.title,
        onSelect: async (item) => {
          await sdo.commit((next) => {
            next.activeSpaceId = item.id;
            next.activeJournalId = null;
          }, ['nav_last_loc_v2']);
        },
        onAddCurrentLevel: async () => {
          const title = window.prompt('Назва простору:', 'Новий простір');
          if (!title) return;
          await sdo.commit((next) => {
            next.spaces = [...next.spaces, { id: crypto.randomUUID(), title, parentId: activeSpace?.parentId ?? null, childCount: 0 }];
          }, ['spaces_nodes_v2']);
        }
      })
    }, [activeSpace?.title ?? 'Простір']);

    const spaceChildrenBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main',
      disabled: spaceChildren.length > 0 ? null : 'disabled',
      onClick: () => openPicker({
        title: 'Оберіть підпростір поточного рівня',
        items: spaceChildren,
        getLabel: (item) => item.title,
        onSelect: async (item) => {
          await sdo.commit((next) => {
            next.activeSpaceId = item.id;
            next.activeJournalId = null;
          }, ['nav_last_loc_v2']);
        },
        onAddCurrentLevel: async () => {
          const title = window.prompt('Назва підпростору:', 'Новий підпростір');
          if (!title || !activeSpace?.id) return;
          await sdo.commit((next) => {
            next.spaces = [...next.spaces, { id: crypto.randomUUID(), title, parentId: activeSpace.id, childCount: 0 }];
          }, ['spaces_nodes_v2']);
        }
      })
    }, [spaceChildren[0]?.title ?? '—']);

    const spacePlusBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-plus',
      onClick: async () => {
        const title = window.prompt('Назва підпростору:', 'Новий підпростір');
        if (!title || !activeSpace?.id) return;
        await sdo.commit((next) => {
          next.spaces = [...next.spaces, { id: crypto.randomUUID(), title, parentId: activeSpace.id, childCount: 0 }];
        }, ['spaces_nodes_v2']);
      }
    }, ['+']);

    const journalBackBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-back',
      disabled: canGoBackJournal(activeJournal, state.activeSpaceId) ? null : 'disabled',
      onClick: async () => {
        if (!activeJournal || activeJournal.parentId === state.activeSpaceId) return;
        await sdo.commit((next) => {
          next.activeJournalId = activeJournal.parentId;
        }, ['nav_last_loc_v2']);
      }
    }, ['←']);

    const journalCurrentBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main',
      onClick: () => openPicker({
        title: 'Оберіть журнал поточного рівня',
        items: journalSiblings,
        getLabel: getJournalLabel,
        onSelect: async (item) => {
          await sdo.commit((next) => {
            next.activeJournalId = item.id;
          }, ['nav_last_loc_v2']);
        },
        onAddCurrentLevel: async () => {
          if (!state.activeSpaceId) return;
          const parentId = activeJournal ? activeJournal.parentId : state.activeSpaceId;
          await createJournalWithTemplate({ state, parentId, titlePrompt: 'Вхідні поточні' });
        }
      })
    }, [activeJournal ? getJournalLabel(activeJournal) : 'Додай журнал']);

    const journalChildrenBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main',
      disabled: journalChildren.length > 0 ? null : 'disabled',
      onClick: () => openPicker({
        title: 'Оберіть піджурнал поточного рівня',
        items: journalChildren,
        getLabel: getJournalLabel,
        onSelect: async (item) => {
          await sdo.commit((next) => {
            next.activeJournalId = item.id;
          }, ['nav_last_loc_v2']);
        },
        onAddCurrentLevel: async () => {
          if (!activeJournal) return;
          await createJournalWithTemplate({ state, parentId: activeJournal.id, titlePrompt: 'Піджурнал' });
        }
      })
    }, [journalChildren[0] ? getJournalLabel(journalChildren[0]) : '—']);

    const journalPlusBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-plus',
      onClick: async () => {
        if (!state.activeSpaceId) return;
        const parentId = activeJournal ? activeJournal.id : state.activeSpaceId;
        await createJournalWithTemplate({ state, parentId, titlePrompt: activeJournal ? 'Піджурнал' : 'Вхідні поточні' });
      }
    }, ['+']);

    const spaceRow = h('div', { class: 'sdo-nav-row sdo-nav-row-space' }, [spaceBackBtn, spaceCurrentBtn, spaceChildrenBtn, spacePlusBtn]);
    const journalRow = h('div', { class: 'sdo-nav-row sdo-nav-row-journal' }, [journalBackBtn, journalCurrentBtn, journalChildrenBtn, journalPlusBtn]);

    navigationHost.innerHTML = '';
    // Left-to-right layout: Spaces then Journals
    navigationHost.append(spaceRow, journalRow);
  }

  function renderButtons() {
    const uiButtons = sdo.ui.listButtons({ location: 'toolbar' });
    const commandButtons = sdo.commands.list((c) => c.menu?.location === 'toolbar');

    const left = h('div', { class: 'sdo-toolbar-left' });
    const right = h('div', { class: 'sdo-toolbar-right' }, [settingsButton, templatesButton, addModuleButton]);

    for (const def of uiButtons) {
      if (!evaluateGuard(def.visible, true)) continue;
      left.append(h('button', {
        class: 'sdo-module-button',
        disabled: evaluateGuard(def.enabled, true) ? null : 'disabled',
        onClick: () => def.onClick({ api, sdo })
      }, [def.label]));
    }

    for (const cmd of commandButtons) {
      if (!evaluateGuard(cmd.when, true)) continue;
      left.append(h('button', {
        class: 'sdo-module-button',
        onClick: async () => sdo.commands.run(cmd.id)
      }, [cmd.title]));
    }

    toolbar.innerHTML = '';
    toolbar.append(left, right);
  }

  let panelCleanup = null;
  function renderPanel() {
    panelCleanup?.();
    panelCleanup = null;
    panelsHost.innerHTML = '';

    const mainPanel = sdo.ui.listPanels({ location: 'main' })[0] ?? null;
    const settingsPanel = sdo.ui.listPanels({ location: 'settings' })[0] ?? null;
    const panel = mainPanel ?? settingsPanel;
    if (!panel) return;

    const wrapper = h('div', { class: 'sdo-panel' }, [h('h3', {}, [panel.title])]);
    panelsHost.append(wrapper);
    const maybeCleanup = panel.render(wrapper, { api, sdo });
    if (typeof maybeCleanup === 'function') panelCleanup = maybeCleanup;
  }

  async function renderSettings() {
    settingsHost.innerHTML = '';
    const tabs = sdo.settings.listTabs();
    for (const tab of tabs) {
      const tabEl = h('div', { class: 'sdo-settings-tab' }, [h('h4', {}, [tab.title])]);
      for (const def of tab.items) {
        for (const field of def.fields) {
          if (typeof field.when === 'function' && !field.when({ api, sdo })) continue;
          const row = h('label', { class: 'sdo-settings-row' }, [field.label]);
          const value = await field.read({ api, sdo });
          const input = h('input', { value: value ?? '', type: field.type === 'number' ? 'number' : 'text' });
          input.addEventListener('change', () => field.write({ api, sdo }, input.value));
          row.append(input);
          tabEl.append(row);
        }
      }
      settingsHost.append(tabEl);
    }
  }

  async function refresh() {
    await renderNavigation();
    renderButtons();
    renderPanel();
    await renderSettings();
  }

  const unsubscribeRegistry = sdo.ui.subscribe(refresh);
  const unsubscribeState = sdo.on('state:changed', refresh);
  refresh();

  const children = [navigationHost, toolbar, panelsHost, settingsHost, modalLayer].filter(Boolean);
  const root = h('div', { class: 'sdo-core-shell' }, children);
  mount.innerHTML = '';
  mount.append(root);

  return {
    destroy() {
      unsubscribeRegistry();
      unsubscribeState();
      panelCleanup?.();
      root.remove();
    }
  };
}
