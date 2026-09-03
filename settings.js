(() => {
  const form = root.closest('form');
  const orderInput = form && form.querySelector('[data-role="plugin-order"]');
  const hiddenInput = form && form.querySelector('[data-role="hidden-plugins"]');
  const container = document.getElementById('settings-plugins-container');
  if (!form || !orderInput || !hiddenInput || !container) return;

  const cardSelector = '.plugin-settings-card, .plugin-card';

  const cardFromTarget = (target) => {
    if (!(target instanceof Element)) return null;
    const card = target.closest(cardSelector);
    return card && card.parentElement === container ? card : null;
  };

  const cardItem = (card) => {
    if (!card || card.parentElement !== container) return null;
    const pluginForm = card.querySelector('.plugin-config-form[data-plugin-id]');
    const id = pluginForm && String(pluginForm.dataset.pluginId || '').trim();
    return id ? { id, card } : null;
  };

  // 순서 변경/숨김을 여러 번 반복하거나 다른 플러그인이 설정 DOM을 다시 그릴 때
  // 내용이 사라진 카드 shell 또는 같은 plugin-id의 중복 카드가 남을 수 있다.
  // BookOasis의 실제 플러그인 카드는 항상 header + plugin-config-form을 가지므로
  // 그 조건을 만족하지 않는 direct child card는 안전하게 제거한다.
  const cleanupOrphanCards = () => {
    const seen = new Set();
    let changed = false;
    Array.from(container.children).forEach((node) => {
      if (!(node instanceof Element) || !node.matches(cardSelector)) return;
      const item = cardItem(node);
      const hasHeader = !!node.querySelector('[data-role="plugin-card-toggle"]');
      if (!item || !hasHeader || seen.has(item.id)) {
        console.warn('[PluginSettingsOrder] stale/blank plugin card removed', item && item.id);
        node.remove();
        changed = true;
        return;
      }
      seen.add(item.id);
    });
    return changed;
  };

  const getCards = () => {
    cleanupOrphanCards();
    return Array.from(container.children).map(cardItem).filter(Boolean);
  };

  const previous = container.__psoDndController;
  const inheritedDefaultOrder = previous && Array.isArray(previous.defaultOrder)
    ? previous.defaultOrder.slice()
    : null;
  if (previous && typeof previous.destroy === 'function') previous.destroy({ restore: true });

  const parseList = (value) => {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    const text = String(value || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch (_) {}
    return text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  };

  const HIDE_ALL_SENTINEL = '__PSO_HIDE_ALL__';
  const availableIds = getCards().map((item) => item.id);
  const defaultOrder = (inheritedDefaultOrder || availableIds)
    .filter((id, index, values) => availableIds.includes(id) && values.indexOf(id) === index);
  defaultOrder.push(...availableIds.filter((id) => !defaultOrder.includes(id)));
  let order = [...new Set(parseList(config.PLUGIN_ORDER).filter((id) => availableIds.includes(id)))];
  order.push(...availableIds.filter((id) => !order.includes(id)));
  const configuredHidden = parseList(config.HIDDEN_PLUGINS);
  let hideAll = configuredHidden.includes(HIDE_ALL_SENTINEL);
  let hidden = hideAll
    ? new Set(availableIds)
    : new Set(configuredHidden.filter((id) => availableIds.includes(id)));
  // v1.1.8 이전의 "모두 숨김" 상태도 자동으로 hide-all 모드로 승격한다.
  // 이후 새 플러그인이 설치되어도 빈 카드처럼 다시 노출되지 않는다.
  if (!hideAll && availableIds.length > 0 && availableIds.every((id) => hidden.has(id))) {
    hideAll = true;
  }

  let active = false;
  let draggedCard = null;
  let saveTimer = null;
  let saveBusy = false;
  let wasDragging = false;
  let hiddenToolbar = null;
  let listenersBound = false;
  let reconcileQueued = false;
  const displayByCard = new WeakMap();
  const viewerDisplayByElement = new WeakMap();

  // Some plugins hide their own navigation entries by querying every
  // [data-plugin-id] in the document. BookOasis reuses that attribute inside
  // the plugin settings cards, so such a global query can hide a card header,
  // form, toggle, or action button while leaving the outer card visible.
  // Remember the original inline display and repair only elements explicitly
  // marked by that foreign hide operation. plugin_settings_order's own hidden
  // cards do not use this marker, so the two mechanisms remain independent.
  const expectedViewerDisplay = (element) => {
    if (element.matches('[data-role="plugin-card-toggle"], .plugin-config-form')) return 'flex';
    if (element.matches('.plugin-sample-update-btn')) return 'inline-flex';
    return '';
  };

  const rememberViewerDisplays = () => {
    container.querySelectorAll('[data-plugin-id]').forEach((element) => {
      if (!(element instanceof HTMLElement) || viewerDisplayByElement.has(element)) return;
      const current = element.style.display;
      if (current && current !== 'none') {
        viewerDisplayByElement.set(element, current);
      } else if (!element.hasAttribute('data-hidden-by-plugins-viewer')) {
        viewerDisplayByElement.set(element, current || '');
      }
    });
  };

  const restoreViewerHiddenElements = () => {
    let changed = false;
    container.querySelectorAll('[data-hidden-by-plugins-viewer="1"]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      let display = viewerDisplayByElement.get(element);
      if (display === undefined || display === 'none') display = expectedViewerDisplay(element);
      if (display) element.style.setProperty('display', display);
      else element.style.removeProperty('display');
      element.removeAttribute('data-hidden-by-plugins-viewer');
      changed = true;
    });
    rememberViewerDisplays();
    return changed;
  };

  rememberViewerDisplays();
  restoreViewerHiddenElements();

  const ownCard = form.closest(cardSelector);
  const ownToggle = ownCard && ownCard.querySelector('.plugin-toggle-checkbox');

  const cardName = (card, fallback) => {
    const heading = card.querySelector('h4');
    if (!heading) return fallback;
    const text = Array.from(heading.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join(' ');
    return text || heading.textContent.trim() || fallback;
  };

  const rememberDisplay = (card) => {
    if (!displayByCard.has(card)) {
      const display = card.style.display;
      displayByCard.set(card, display && display !== 'none' ? display : 'flex');
    }
    return displayByCard.get(card);
  };

  const resetCard = (card) => {
    card.hidden = false;
    card.removeAttribute('aria-hidden');
    card.style.setProperty('display', rememberDisplay(card));
    card.removeAttribute('draggable');
    delete card.dataset.psoPluginId;
    card.classList.remove('pso-dragging', 'pso-drop-target');
    card.querySelectorAll('[data-pso-action="hide"]').forEach((button) => button.remove());
  };

  const restoreCards = () => {
    const current = getCards();
    const byId = new Map(current.map((item) => [item.id, item.card]));
    current.forEach(({ card }) => resetCard(card));
    defaultOrder.forEach((id) => {
      const card = byId.get(id);
      if (card) container.appendChild(card);
    });
  };

  const writeConfigInputs = () => {
    orderInput.value = JSON.stringify(order);
    const hiddenIds = order.filter((id) => hidden.has(id));
    hiddenInput.value = JSON.stringify(
      hideAll && order.length > 0 && hiddenIds.length === order.length
        ? [HIDE_ALL_SENTINEL]
        : hiddenIds
    );
  };

  const ensureToolbar = () => {
    container.querySelectorAll('[data-pso-hidden-toolbar]').forEach((toolbar) => toolbar.remove());
    hiddenToolbar = document.createElement('div');
    hiddenToolbar.className = 'pso-hidden-toolbar';
    hiddenToolbar.dataset.psoHiddenToolbar = '1';
    container.insertBefore(hiddenToolbar, container.firstChild);
  };

  const renderHiddenToolbar = () => {
    if (!active || !hiddenToolbar) return;
    hiddenToolbar.replaceChildren();
    const byId = new Map(getCards().map((item) => [item.id, item]));
    const hiddenIds = [...hidden].filter((id) => byId.has(id));
    if (!hiddenIds.length) {
      hiddenToolbar.style.display = 'none';
      return;
    }
    hiddenToolbar.style.display = 'flex';
    const label = document.createElement('span');
    label.className = 'pso-hidden-label';
    label.textContent = '숨긴 플러그인';
    hiddenToolbar.appendChild(label);
    hiddenIds.forEach((id) => {
      const item = byId.get(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pso-show-button';
      button.dataset.psoAction = 'show';
      button.dataset.psoPluginId = id;
      button.title = `${cardName(item.card, id)} 표시`;
      button.innerHTML = '<i class="fa-solid fa-eye"></i>';
      button.append(document.createTextNode(` ${cardName(item.card, id)}`));
      hiddenToolbar.appendChild(button);
    });
  };

  const applyCards = () => {
    if (!active) return;
    const current = getCards();
    const byId = new Map(current.map((item) => [item.id, item.card]));
    order = order.filter((id) => byId.has(id));
    hidden = new Set([...hidden].filter((id) => byId.has(id)));
    current.forEach((item) => {
      if (!order.includes(item.id)) order.push(item.id);
      if (hideAll) hidden.add(item.id);
      const display = rememberDisplay(item.card);
      item.card.dataset.psoPluginId = item.id;
      item.card.draggable = true;
      const isHidden = hidden.has(item.id);
      item.card.hidden = isHidden;
      item.card.toggleAttribute('aria-hidden', isHidden);
      item.card.style.setProperty('display', isHidden ? 'none' : display, isHidden ? 'important' : '');
      if (!item.card.querySelector('[data-pso-action="hide"]')) {
        const toggleZone = item.card.querySelector('[data-role="plugin-toggle-zone"]');
        if (toggleZone) {
          const hideButton = document.createElement('button');
          hideButton.type = 'button';
          hideButton.className = 'pso-hide-button';
          hideButton.dataset.psoAction = 'hide';
          hideButton.dataset.psoPluginId = item.id;
          hideButton.title = '플러그인 설정 카드 숨기기';
          hideButton.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
          toggleZone.prepend(hideButton);
        }
      }
    });
    order.forEach((id) => {
      const card = byId.get(id);
      if (card) container.appendChild(card);
    });
    writeConfigInputs();
    renderHiddenToolbar();
  };

  const saveOrder = () => {
    if (!active) return;
    writeConfigInputs();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      if (!active) return;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, 120);
  };

  const onSubmit = async (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (saveBusy) return;
    saveBusy = true;
    writeConfigInputs();
    try {
      const fetchConfig = typeof window.__origFetchForPluginsViewer === 'function'
        ? window.__origFetchForPluginsViewer.bind(window)
        : window.fetch.bind(window);
      const response = await fetchConfig('/api/media/metadata/plugins/save-config', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'general',
          plugin_id: pluginId,
          config: { PLUGIN_ORDER: orderInput.value, HIDDEN_PLUGINS: hiddenInput.value },
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.error || '플러그인 설정 저장에 실패했습니다.');
      if (typeof window.showToast === 'function') window.showToast(payload.message || '플러그인 설정을 저장했습니다.', 'success');
    } catch (error) {
      console.error('[PluginSettingsOrder] 설정 저장 실패:', error);
      if (typeof window.showToast === 'function') window.showToast(error.message || '플러그인 설정 저장에 실패했습니다.', 'error');
    } finally {
      saveBusy = false;
    }
  };

  const clearDragState = () => getCards().forEach(({ card }) => card.classList.remove('pso-dragging', 'pso-drop-target'));

  const onClick = (event) => {
    if (!active) return;
    const actionElement = event.target.closest('[data-pso-action]');
    if (!actionElement) return;
    event.preventDefault();
    event.stopPropagation();
    const id = actionElement.dataset.psoPluginId;
    if (!id) return;
    if (actionElement.dataset.psoAction === 'hide') {
      hidden.add(id);
      if (order.length > 0 && order.every((pluginId) => hidden.has(pluginId))) hideAll = true;
    }
    if (actionElement.dataset.psoAction === 'show') {
      hideAll = false;
      hidden.delete(id);
    }
    applyCards();
    saveOrder();
  };

  const onDragStart = (event) => {
    if (!active || event.target.closest('[data-pso-action], input, button, label, select, textarea')) return;
    const card = cardFromTarget(event.target);
    if (!card || !card.dataset.psoPluginId || hidden.has(card.dataset.psoPluginId)) return;
    draggedCard = card;
    wasDragging = true;
    card.classList.add('pso-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.psoPluginId);
    }
  };

  const onDragOver = (event) => {
    const card = cardFromTarget(event.target);
    if (!active || !draggedCard || !card || draggedCard === card || hidden.has(card.dataset.psoPluginId)) return;
    event.preventDefault();
    clearDragState();
    card.classList.add('pso-drop-target');
    const box = card.getBoundingClientRect();
    container.insertBefore(draggedCard, event.clientY > box.top + box.height / 2 ? card.nextSibling : card);
  };

  const onDrop = (event) => {
    if (!active || !draggedCard) return;
    event.preventDefault();
    cleanupOrphanCards();
    order = getCards().map((item) => item.id);
    applyCards();
    saveOrder();
  };

  const onDragEnd = () => {
    draggedCard = null;
    clearDragState();
    window.setTimeout(() => { wasDragging = false; }, 0);
  };

  const onClickCapture = (event) => {
    if (wasDragging && !event.target.closest('[data-pso-action]')) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const listeners = [
    ['click', onClick, false],
    ['dragstart', onDragStart, false],
    ['dragover', onDragOver, false],
    ['drop', onDrop, false],
    ['dragend', onDragEnd, false],
    ['click', onClickCapture, true],
  ];

  const bindListeners = () => {
    if (listenersBound) return;
    listeners.forEach(([type, handler, capture]) => container.addEventListener(type, handler, capture));
    listenersBound = true;
  };

  const unbindListeners = () => {
    if (!listenersBound) return;
    listeners.forEach(([type, handler, capture]) => container.removeEventListener(type, handler, capture));
    listenersBound = false;
  };

  const activate = () => {
    if (active) return;
    active = true;
    rememberViewerDisplays();
    restoreViewerHiddenElements();
    ensureToolbar();
    bindListeners();
    applyCards();
  };

  const deactivate = ({ restore = true } = {}) => {
    active = false;
    draggedCard = null;
    wasDragging = false;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = null;
    unbindListeners();
    if (hiddenToolbar) hiddenToolbar.remove();
    hiddenToolbar = null;
    container.querySelectorAll('[data-pso-hidden-toolbar]').forEach((toolbar) => toolbar.remove());
    if (restore) restoreCards();
  };

  const onOwnToggleChange = () => {
    if (!ownToggle || ownToggle.checked) activate();
    else deactivate();
  };

  const onPluginManagerChanged = (event) => {
    const detail = event && event.detail;
    if (!detail || detail.plugin_id !== pluginId) return;
    if (detail.action === 'inactive') {
      if (ownToggle) ownToggle.checked = false;
      deactivate();
    } else if (detail.action === 'active') {
      if (ownToggle) ownToggle.checked = true;
      activate();
    }
  };

  const setupOwnCard = () => {
    if (!ownCard) return;
    const body = ownCard.querySelector('[data-plugin-body]');
    const header = ownCard.querySelector('[data-role="plugin-card-toggle"]');
    const chevron = ownCard.querySelector('[data-plugin-chevron]');
    const badge = ownCard.querySelector('h4 span');
    if (body) body.style.display = 'none';
    if (chevron) chevron.remove();
    if (badge && badge.textContent.trim() === '설정 있음') badge.remove();
    if (header) {
      header.style.cursor = 'default';
      if (header.dataset.psoOwnHeaderBound !== '1') {
        header.dataset.psoOwnHeaderBound = '1';
        header.addEventListener('click', (event) => {
          if (!event.target.closest('[data-role="plugin-toggle-zone"]')) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
      }
    }
    const submit = ownCard.querySelector('button[type="submit"]');
    if (submit) submit.style.display = 'none';
  };

  const reconcileObserver = new MutationObserver((mutations) => {
    if (!active) return;

    // Repair foreign per-element hiding immediately. MutationObserver runs at
    // the microtask checkpoint, before the browser's next paint in the normal
    // rendering flow, preventing the visible-card -> blank-card transition.
    const viewerHideTouched = mutations.some((mutation) => (
      mutation.type === 'attributes' &&
      mutation.target instanceof HTMLElement &&
      mutation.target.closest('#settings-plugins-container') === container &&
      mutation.target.getAttribute('data-hidden-by-plugins-viewer') === '1'
    ));
    if (viewerHideTouched) restoreViewerHiddenElements();

    // Child-list mutations still need the existing orphan/duplicate cleanup.
    if (!mutations.some((mutation) => mutation.type === 'childList') || reconcileQueued) return;
    reconcileQueued = true;
    window.queueMicrotask(() => {
      reconcileQueued = false;
      if (!active) return;
      restoreViewerHiddenElements();
      if (!cleanupOrphanCards()) return;
      const validIds = new Set(getCards().map((item) => item.id));
      order = order.filter((id) => validIds.has(id));
      hidden = new Set([...hidden].filter((id) => validIds.has(id)));
      writeConfigInputs();
      renderHiddenToolbar();
    });
  });
  reconcileObserver.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-hidden-by-plugins-viewer', 'style'],
  });

  container.querySelectorAll('[data-pso-hidden-toolbar]').forEach((toolbar) => toolbar.remove());
  getCards().forEach(({ card }) => {
    if (card.dataset.psoPluginId || card.querySelector('[data-pso-action="hide"]')) resetCard(card);
  });
  form.addEventListener('submit', onSubmit, true);
  if (ownToggle) ownToggle.addEventListener('change', onOwnToggleChange);
  window.addEventListener('plugin_manager:plugins_changed', onPluginManagerChanged);
  container.__psoDndController = {
    defaultOrder: defaultOrder.slice(),
    destroy(options = {}) {
      deactivate({ restore: options.restore !== false });
      form.removeEventListener('submit', onSubmit, true);
      if (ownToggle) ownToggle.removeEventListener('change', onOwnToggleChange);
      window.removeEventListener('plugin_manager:plugins_changed', onPluginManagerChanged);
      reconcileObserver.disconnect();
      if (container.__psoDndController === this) delete container.__psoDndController;
    },
  };

  setupOwnCard();
  if (!ownToggle || ownToggle.checked) activate();
  else deactivate();
})();
