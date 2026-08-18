(() => {
  const listRoot = root.querySelector('[data-role="plugin-order-list"]');
  const form = root.closest('form');
  const orderInput = form && form.querySelector('[data-role="plugin-order"]');
  const hiddenInput = form && form.querySelector('[data-role="hidden-plugins"]');
  if (!listRoot || !form || !orderInput || !hiddenInput) return;

  const ownId = pluginId;
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const cards = () => Array.from(document.querySelectorAll('#settings-plugins-container .plugin-config-form'))
    .map((pluginForm) => {
      const id = pluginForm.dataset.pluginId;
      const card = pluginForm.closest('.plugin-card');
      const title = card && card.querySelector('h4');
      return id && card ? { id, card, name: (title && title.textContent.trim()) || id } : null;
    })
    .filter((item) => item && item.id !== ownId);

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

  const available = cards();
  const availableIds = available.map((item) => item.id);
  const initialOrder = availableIds.slice();
  const configuredOrder = parseList(config.PLUGIN_ORDER);
  let order = [...new Set(configuredOrder.filter((id) => availableIds.includes(id)))];
  order.push(...availableIds.filter((id) => !order.includes(id)));
  let hidden = new Set(parseList(config.HIDDEN_PLUGINS).filter((id) => availableIds.includes(id)));

  const writeConfigInputs = () => {
    orderInput.value = JSON.stringify(order);
    hiddenInput.value = JSON.stringify(order.filter((id) => hidden.has(id)));
  };

  const applyCards = () => {
    const current = cards();
    const byId = new Map(current.map((item) => [item.id, item]));
    const parent = current[0] && current[0].card.parentElement;
    if (!parent) return;
    order.forEach((id) => {
      const item = byId.get(id);
      if (item) parent.appendChild(item.card);
    });
    current.forEach((item) => {
      item.card.style.display = hidden.has(item.id) ? 'none' : '';
    });
    const ownCard = form.closest('.plugin-card');
    if (ownCard) parent.appendChild(ownCard);
  };

  const render = () => {
    const byId = new Map(cards().map((item) => [item.id, item]));
    listRoot.innerHTML = order.map((id, index) => {
      const item = byId.get(id);
      if (!item) return '';
      const isHidden = hidden.has(id);
      return `
        <div class="pso-order-item${isHidden ? ' pso-hidden' : ''}" data-plugin-id="${id}">
          <span class="pso-order-name">${escapeHtml(item.name)}<span class="pso-order-id">${escapeHtml(id)}</span></span>
          <button type="button" class="pso-order-button" data-action="move-up" title="위로 이동" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
          <button type="button" class="pso-order-button" data-action="move-down" title="아래로 이동" ${index === order.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
          <label class="pso-hide-control"><input type="checkbox" data-action="toggle-hidden" ${isHidden ? 'checked' : ''}>숨기기</label>
        </div>`;
    }).join('');
    writeConfigInputs();
    applyCards();
  };

  listRoot.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = button.closest('[data-plugin-id]');
    const index = item ? order.indexOf(item.dataset.pluginId) : -1;
    if (index < 0) return;
    if (button.dataset.action === 'move-up' && index > 0) {
      [order[index - 1], order[index]] = [order[index], order[index - 1]];
    } else if (button.dataset.action === 'move-down' && index < order.length - 1) {
      [order[index + 1], order[index]] = [order[index], order[index + 1]];
    } else {
      return;
    }
    render();
  });

  listRoot.addEventListener('change', (event) => {
    if (event.target.dataset.action !== 'toggle-hidden') return;
    const item = event.target.closest('[data-plugin-id]');
    if (!item) return;
    if (event.target.checked) hidden.add(item.dataset.pluginId);
    else hidden.delete(item.dataset.pluginId);
    render();
  });

  const resetButton = root.querySelector('[data-action="reset-order"]');
  if (resetButton) resetButton.addEventListener('click', () => {
    order = initialOrder.slice();
    hidden.clear();
    render();
  });

  render();
})();
