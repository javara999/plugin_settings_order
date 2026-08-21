(() => {
  const form = root.closest('form');
  const orderInput = form && form.querySelector('[data-role="plugin-order"]');
  const hiddenInput = form && form.querySelector('[data-role="hidden-plugins"]');
  const container = document.getElementById('settings-plugins-container');
  if (!form || !orderInput || !hiddenInput || !container) return;

  const previous = container.__psoDndController;
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  const cardSelector = '.plugin-settings-card, .plugin-card';
  const getCards = () => Array.from(container.querySelectorAll('.plugin-config-form'))
    .map((pluginForm) => {
      const id = pluginForm.dataset.pluginId;
      const card = pluginForm.closest(cardSelector);
      return id && card ? { id, card } : null;
    })
    .filter(Boolean);

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

  const available = getCards();
  const availableIds = available.map((item) => item.id);
  let order = [...new Set(parseList(config.PLUGIN_ORDER).filter((id) => availableIds.includes(id)))];
  order.push(...availableIds.filter((id) => !order.includes(id)));
  let hidden = new Set(parseList(config.HIDDEN_PLUGINS).filter((id) => availableIds.includes(id)));
  let draggedCard = null;
  let saveTimer = null;
  let wasDragging = false;
  const displayByCard = new WeakMap();

  const ownCard = form.closest(cardSelector);
  const oldToolbar = container.querySelector('[data-pso-hidden-toolbar]');
  if (oldToolbar) oldToolbar.remove();
  const hiddenToolbar = document.createElement('div');
  hiddenToolbar.className = 'pso-hidden-toolbar';
  hiddenToolbar.dataset.psoHiddenToolbar = '1';
  container.insertBefore(hiddenToolbar, container.firstChild);

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

  const writeConfigInputs = () => {
    orderInput.value = JSON.stringify(order);
    hiddenInput.value = JSON.stringify(order.filter((id) => hidden.has(id)));
  };

  const renderHiddenToolbar = () => {
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
      if (!item) return;
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
    const current = getCards();
    const byId = new Map(current.map((item) => [item.id, item.card]));
    order = order.filter((id) => byId.has(id));
    current.forEach((item) => {
      if (!order.includes(item.id)) order.push(item.id);
      item.card.dataset.psoPluginId = item.id;
      item.card.draggable = true;
      if (!displayByCard.has(item.card)) {
        const display = item.card.style.display;
        displayByCard.set(item.card, display && display !== 'none' ? display : 'flex');
      }
      item.card.style.display = displayByCard.get(item.card);
      item.card.hidden = hidden.has(item.id);
      if (!item.card.querySelector('[data-pso-action="hide"]')) {
        const toggleZone = item.card.querySelector('[data-role="plugin-toggle-zone"]');
        if (toggleZone) {
          const hideButton = document.createElement('button');
          hideButton.type = 'button';
          hideButton.className = 'pso-hide-button';
          hideButton.dataset.psoAction = 'hide';
          hideButton.dataset.psoPluginId = item.id;
          hideButton.title = '이 플러그인 설정 카드 숨기기';
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
    writeConfigInputs();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, 120);
  };

  let saveBusy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (saveBusy) return;
    saveBusy = true;
    writeConfigInputs();
    try {
      const response = await fetch('/api/media/metadata/plugins/save-config', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'general',
          plugin_id: pluginId,
          config: {
            PLUGIN_ORDER: orderInput.value,
            HIDDEN_PLUGINS: hiddenInput.value,
          },
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
  }, true);

  const clearDragState = () => {
    getCards().forEach(({ card }) => card.classList.remove('pso-dragging', 'pso-drop-target'));
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
      header.addEventListener('click', (event) => {
        if (!event.target.closest('[data-role="plugin-toggle-zone"]')) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
    const submit = ownCard.querySelector('button[type="submit"]');
    if (submit) submit.style.display = 'none';
  };

  const onClick = (event) => {
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
    const card = event.target.closest('[data-pso-plugin-id]');
    if (!card || hidden.has(card.dataset.psoPluginId)) return;
    draggedCard = card;
    wasDragging = true;
    card.classList.add('pso-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.dataset.psoPluginId);
  };

  const onDragOver = (event) => {
    const card = event.target.closest('[data-pso-plugin-id]');
    if (!draggedCard || !card || draggedCard === card || hidden.has(card.dataset.psoPluginId)) return;
    event.preventDefault();
    clearDragState();
    card.classList.add('pso-drop-target');
    const box = card.getBoundingClientRect();
    const insertAfter = event.clientY > box.top + box.height / 2;
    container.insertBefore(draggedCard, insertAfter ? card.nextSibling : card);
  };

  const onDrop = (event) => {
    if (!draggedCard) return;
    event.preventDefault();
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
  listeners.forEach(([type, handler, capture]) => container.addEventListener(type, handler, capture));
  container.__psoDndController = {
    destroy() {
      listeners.forEach(([type, handler, capture]) => container.removeEventListener(type, handler, capture));
      if (saveTimer) window.clearTimeout(saveTimer);
      delete container.__psoDndController;
    },
  };

  setupOwnCard();
  applyCards();
})();
