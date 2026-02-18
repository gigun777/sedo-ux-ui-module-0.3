/**
 * Universal settings shell modal.
 * Renders feature navigation + section navigation + section content via registry providers.
 */
(function attachSettingsShell(global) {
  const UI = (global.UI = global.UI || {});
  UI.settings = UI.settings || {};

  function createNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function openSettingsModal(options = {}) {
    if (!UI.modal?.open) {
      throw new Error('Settings shell requires UI.modal.open to be available');
    }

    const registry = UI.settings.registry;
    const features = registry?.listFeatures?.() || [];
    if (!features.length) {
      throw new Error('Settings shell: no registered settings features found');
    }

    const state = UI.settings.createState?.() || {
      setDraft() {},
      getDraft() { return {}; },
      apply() {},
      clear() {}
    };

    const initialFeature = registry.getFeature?.(options.initialFeature) || features[0];
    let selectedFeatureId = initialFeature.id;
    const initialSections = registry.listSections(selectedFeatureId);
    let selectedSectionId = options.initialSection;
    if (!initialSections.some((section) => section.id === selectedSectionId)) {
      selectedSectionId = initialSections[0]?.id ?? null;
    }
    if (!selectedSectionId) {
      throw new Error(`Settings shell: feature "${selectedFeatureId}" has no sections`);
    }

    const root = createNode('div', 'sdo-settings-modal');
    const panes = createNode('div', 'sdo-settings-modal-panes sdo-settings-modal-panes--patch4');
    const featureNavPane = createNode('aside', 'sdo-settings-modal-feature-nav');
    const sectionNavPane = createNode('aside', 'sdo-settings-modal-nav');
    const contentPane = createNode('section', 'sdo-settings-modal-content');
    const overlayHost = createNode('div', 'sdo-settings-overlay-host');

    const featureList = createNode('div', 'sdo-settings-feature-items');
    featureNavPane.append(featureList);

    const navList = createNode('div', 'sdo-settings-nav-items');
    sectionNavPane.append(navList);

    const contentHeader = createNode('div', 'sdo-settings-pane-header');
    const backBtn = createNode('button', 'btn sdo-settings-go-back-btn', '← Назад');
    const contentTitle = createNode('h3', 'sdo-settings-pane-title');
    const contentBody = createNode('div', 'sdo-settings-pane-body');
    const contentFooter = createNode('div', 'sdo-settings-pane-footer');
    const confirmBtn = createNode('button', 'btn btn-primary', 'Підтвердити');

    contentHeader.append(backBtn, contentTitle);
    contentFooter.append(confirmBtn);
    contentPane.append(contentHeader, contentBody, contentFooter);
    panes.append(featureNavPane, sectionNavPane, contentPane);
    root.append(panes, overlayHost);

    let cleanupCurrent = null;
    let modalId;
    let mobilePane = options.mobilePane || 'feature'; // feature | section | content

    function isMobile() {
      return global.matchMedia?.('(max-width: 900px)')?.matches === true;
    }

    function getCurrentFeature() {
      return registry.getFeature(selectedFeatureId);
    }

    function getCurrentSections() {
      return registry.listSections(selectedFeatureId);
    }

    function getCurrentSection() {
      return getCurrentSections().find((item) => item.id === selectedSectionId) || null;
    }

    function draftKey(featureId, sectionId) {
      return `${featureId}:${sectionId}`;
    }

    async function canLeaveCurrent(nextSectionId) {
      const currentSection = getCurrentSection();
      if (!currentSection || typeof currentSection.canLeave !== 'function') return true;
      return Boolean(await currentSection.canLeave({
        featureId: selectedFeatureId,
        sectionId: selectedSectionId,
        nextSectionId
      }));
    }

    function applyMobileState() {
      root.classList.remove('is-mobile-feature', 'is-mobile-section', 'is-mobile-content');
      if (!isMobile()) return;
      root.classList.add(`is-mobile-${mobilePane}`);
    }

    function sectionCtx(feature, section) {
      const key = draftKey(feature.id, section.id);
      return {
        featureId: feature.id,
        sectionId: section.id,
        draft: state.getDraft(key),
        setDraft: (patch) => state.setDraft(key, patch),
        getDraft: () => state.getDraft(key),
        openChildSettings(config = {}) {
          const childRoot = createNode('div', 'sdo-settings-child');
          const childBody = createNode('div', 'sdo-settings-child-body');
          childRoot.appendChild(childBody);
          overlayHost.innerHTML = '';
          overlayHost.appendChild(childRoot);
          const closeChild = () => childRoot.remove();
          if (typeof config.render === 'function') {
            config.render(childBody, { close: closeChild });
          }
          return { close: closeChild };
        }
      };
    }

    function renderFeatureNav() {
      featureList.innerHTML = '';
      features.forEach((feature) => {
        const item = createNode('button', 'btn sdo-settings-feature-item', feature.title);
        if (feature.id === selectedFeatureId) item.classList.add('is-active');
        item.addEventListener('click', async () => {
          if (feature.id === selectedFeatureId) return;
          const canLeave = await canLeaveCurrent(null);
          if (!canLeave) return;

          selectedFeatureId = feature.id;
          const sections = getCurrentSections();
          selectedSectionId = sections[0]?.id ?? null;
          if (!selectedSectionId) {
            UI.toast?.show?.('У фічі немає доступних секцій', { type: 'error' });
            return;
          }

          mobilePane = isMobile() ? 'section' : mobilePane;
          render();
});
        featureList.appendChild(item);
      });
    }

    
    function openSectionModal(sectionId) {
      const UIX = (typeof window !== 'undefined' ? window.UI : globalThis.UI);

      const feature = getCurrentFeature();
      const section = (getCurrentSections() || []).find((s) => s.id === sectionId) || getCurrentSection();
      if (!feature || !section) return;

      const content = document.createElement('div');
      content.className = 'sdo-settings-section-window';

      content.style.maxHeight = '70vh';
      content.style.overflow = 'auto';
      const ctx = {
        featureId: feature.id,
        sectionId: section.id,
        getSettings: () => UIX?.getSettings?.(),
        applySettings: (patch) => UIX?.applySettings?.(patch),
        settings: UIX?.getSettings?.()
      };

      let cleanup = null;
      try {
        cleanup = section.renderContent?.(content, ctx) || null;
      } catch (e) {
        content.textContent = 'Помилка рендера секції налаштувань: ' + (e?.message || e);
      }

      UIX?.modal?.open?.({
        title: feature.title + ' — ' + section.title,
        contentNode: content,
        escClose: true,
        closeOnOverlay: true,
        onClose: () => { try { cleanup && cleanup(); } catch (e) {} }
      });
    }

function renderSectionNav() {
      navList.innerHTML = '';
      const sections = getCurrentSections();
      sections.forEach((section) => {
        const item = createNode('button', 'btn sdo-settings-nav-item', section.title);
        if (section.id === selectedSectionId) item.classList.add('is-active');
        item.addEventListener('click', async () => {
          if (section.id === selectedSectionId) {
            mobilePane = isMobile() ? 'content' : mobilePane;
            applyMobileState();
            try { openSectionModal(section.id); } catch (e) { console.error(e); }
            return;
          }
const canLeave = await canLeaveCurrent(section.id);
          if (!canLeave) return;
          selectedSectionId = section.id;
          mobilePane = isMobile() ? 'content' : mobilePane;
          renderSectionNav();
          try { openSectionModal(section.id); } catch (e) { console.error(e); }
        });
        navList.appendChild(item);
      });
    }

    async function confirmSection() {
      const feature = getCurrentFeature();
      const section = getCurrentSection();
      if (!feature || !section) return;

      confirmBtn.disabled = true;
      const previousText = confirmBtn.textContent;
      confirmBtn.textContent = 'Застосування...';

      try {
        const ctx = sectionCtx(feature, section);
        const changes = ctx.getDraft();
        const payload = {
          featureId: feature.id,
          sectionId: section.id,
          changes,
          source: 'settings-modal',
          timestamp: Date.now(),
          actor: options.actor || null,
          ...ctx
        };

        if (typeof section.onConfirm === 'function') {
          await section.onConfirm(payload);
        }

        state.apply(draftKey(feature.id, section.id), () => null);
        UI.toast?.show?.('Налаштування застосовано', { type: 'success' });
      } catch (error) {
        UI.toast?.show?.(`Помилка застосування: ${error?.message || 'невідома помилка'}`, { type: 'error' });
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = previousText;
      }
    }

    function renderContent() {
      const feature = getCurrentFeature();
      const section = getCurrentSection();
      if (!feature || !section) return;

      cleanupCurrent?.();
      cleanupCurrent = null;

      contentTitle.textContent = `${feature.title} · ${section.title}`;
      contentBody.innerHTML = '';
      const cleanup = section.renderContent?.(contentBody, sectionCtx(feature, section));

      if (typeof cleanup === 'function') cleanupCurrent = cleanup;
    }

    function render() {
      renderFeatureNav();
      renderSectionNav();
      renderContent();
      applyMobileState();
    }

    async function handleBack() {
      if (isMobile()) {
        if (mobilePane === 'content') {
          mobilePane = 'section';
          applyMobileState();
          return;
        }
        if (mobilePane === 'section') {
          mobilePane = 'feature';
          applyMobileState();
          return;
        }
      }

      const canLeave = await canLeaveCurrent(null);
      if (!canLeave) return;

      state.clear();
      UI.modal.close(modalId);
    }

    const onResize = () => {
      if (!isMobile()) {
        mobilePane = 'content';
      } else if (!['feature', 'section', 'content'].includes(mobilePane)) {
        mobilePane = 'feature';
      }
      applyMobileState();
    };
    global.addEventListener?.('resize', onResize);

    backBtn.addEventListener('click', () => {
      handleBack();
    });
    confirmBtn.addEventListener('click', () => {
      confirmSection();
    });

    mobilePane = isMobile() ? mobilePane : 'content';
    render();

    modalId = UI.modal.open({
      title: options.title || 'Налаштування',
      contentNode: root,
      closeOnOverlay: true,
      escClose: true,
      onClose: () => {
        cleanupCurrent?.();
        state.clear();
        global.removeEventListener?.('resize', onResize);
      }
    });

    return {
      modalId,
      close() {
        UI.modal.close(modalId);
      }
    };
  }

  UI.settings.openModal = openSettingsModal;
})(typeof window !== 'undefined' ? window : globalThis);
