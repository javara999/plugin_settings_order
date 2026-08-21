(() => {
  const form = root.closest('form');
  const orderInput = form && form.querySelector('[data-role="plugin-order"]');
  const hiddenInput = form && form.querySelector('[data-role="hidden-plugins"]');
  const container = document.getElementById('settings-plugins-container');
  if (!form || !orderInput || !hiddenInput || !container) return;

  const cardSelector = '.plugin-settings-card, .plugin-card';
  const getCards = () => Array.from(container.querySelectorAll('.plugin-config-form'))
    .map((pluginForm) => {
      const id = pluginForm.dataset.pluginId;
      const card = pluginForm.closest(cardSelector);
      return id && card ? { id, card } : null;
    })
    .filter(Boolean);

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

  const availableIds = getCards().map((item) => item.id);
  const defaultOrder = (inheritedDefaultOrder || availableIds)
    .filter((id, index, values) => availableIds.includes(id) && values.indexOf(id) === index);
  defaultOrder.push(...availableIds.filter((id) => !defaultOrder.includes(id)));
  let order = [...new Set(parseList(config.PLUGIN_ORDER).filter((id) => availableIds.includes(id)))];
  order.push(...availableIds.filter((id) => !order.includes(id)));
  let hidden = new Set(parseList(config.HIDDEN_PLUGINS).filter((id) => availableIds.includes(id)));

  let active = false;
  let draggedCard = null;
  let saveTimer = null;
  let saveBusy = false;
  let wasDragging = false;
  let hiddenToolbar = null;
  let listenersBound = false;
  const displayByCard = new WeakMap();
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
    hiddenInput.value = JSON.stringify(order.filter((id) => hidden.has(id)));
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
    if (actionElement.dataset.psoAction === 'hide') hidden.add(id);
    if (actionElement.dataset.psoAction === 'show') hidden.delete(id);
    applyCards();
    saveOrder();
  };

  const onDragStart = (event) => {
    if (!active) return;
    const card = event.target.closest('[data-pso-plugin-id]');
    if (!card || hidden.has(card.dataset.psoPluginId)) return;
    draggedCard = card;
    wasDragging = true;
    card.classList.add('pso-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.psoPluginId);
    }
  };

  const onDragOver = (event) => {
    const card = event.target.closest('[data-pso-plugin-id]');
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
    order = Array.from(container.children)
      .map((card) => card.dataset && card.dataset.psoPluginId)
      .filter(Boolean);
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
      if (container.__psoDndController === this) delete container.__psoDndController;
    },
  };

  setupOwnCard();
  if (!ownToggle || ownToggle.checked) activate();
  else deactivate();
})();
