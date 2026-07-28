from pathlib import Path

app_js = r"""const state = { data: null, tab: 'products', query: '' };

const $ = (selector) => document.querySelector(selector);
const money = (value) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value)) + ' ₽'
    : '—';
const pct = (value) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value)) + '%'
    : '—';
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

async function init() {
  const saved = localStorage.getItem('wbPlannerData');

  if (saved) {
    try {
      state.data = JSON.parse(saved);
    } catch {
      localStorage.removeItem('wbPlannerData');
    }
  }

  if (!state.data) {
    const response = await fetch('./backup.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить backup.json: ${response.status}`);
    }
    state.data = await response.json();
  }

  recalculateAll();
  bind();
  render();
}

function getMaxDiscount() {
  const configured = Number(state.data?.settings?.maxDiscount);
  return Number.isFinite(configured) ? configured : 46.5;
}

function roundBySettings(value) {
  if (!Number.isFinite(Number(value))) return null;
  const mode = state.data?.settings?.rounding || 'integer';
  if (mode === 'two-decimals') return Math.round(Number(value) * 100) / 100;
  if (mode === 'one-decimal') return Math.round(Number(value) * 10) / 10;
  return Math.round(Number(value));
}

function recalculateCondition(condition) {
  const retail = Number(condition.currentRetailPrice);
  const minimum = Number(condition.minimumPrice);
  const planned = Number(condition.plannedCampaignPrice);
  const maxDiscount = getMaxDiscount();

  const reasons = [];

  let requiredDiscount = Number(condition.requiredUploadedDiscount);
  if (
    Number.isFinite(retail) &&
    retail > 0 &&
    Number.isFinite(planned)
  ) {
    requiredDiscount = roundBySettings((1 - planned / retail) * 100);
  }

  const deviation = (
    Number.isFinite(planned) &&
    Number.isFinite(minimum)
  ) ? roundBySettings(planned - minimum) : null;

  if (!Number.isFinite(retail) || retail <= 0) {
    reasons.push('Не указана текущая розничная цена');
  }

  if (!Number.isFinite(minimum) || minimum <= 0) {
    reasons.push('Не указана минимальная цена');
  }

  if (!Number.isFinite(planned) || planned <= 0) {
    reasons.push('Не указана плановая цена акции');
  }

  if (
    Number.isFinite(planned) &&
    Number.isFinite(minimum) &&
    planned < minimum
  ) {
    reasons.push(`Цена акции ниже минимальной на ${money(minimum - planned)}`);
  }

  if (
    Number.isFinite(requiredDiscount) &&
    requiredDiscount > maxDiscount
  ) {
    reasons.push(`Требуемая скидка ${pct(requiredDiscount)} выше лимита ${pct(maxDiscount)}`);
  }

  if (
    Number.isFinite(requiredDiscount) &&
    requiredDiscount < 0
  ) {
    reasons.push('Расчётная скидка получилась отрицательной');
  }

  const campaign = state.data.campaigns.find((item) => item.id === condition.campaignId);
  if (!campaign) {
    reasons.push('Акция не найдена');
  }

  condition.requiredUploadedDiscount = requiredDiscount;
  condition.deviationFromMinimum = deviation;
  condition.rejectionReasons = reasons;
  condition.eligible = reasons.length === 0;
  condition.calculationStatus = condition.eligible ? 'Рассчитано' : 'Не подходит';

  return condition;
}

function recalculateAll() {
  state.data.settings ??= {};
  state.data.settings.maxDiscount ??= 46.5;
  state.data.conditions ??= [];
  state.data.campaigns ??= [];
  state.data.products ??= [];

  state.data.conditions.forEach(recalculateCondition);
  save();
}

function bind() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.onclick = () => {
      state.tab = button.dataset.tab;
      document.querySelectorAll('.tab').forEach((item) => {
        item.classList.toggle('active', item === button);
      });
      renderContent();
    };
  });

  $('#search').oninput = (event) => {
    state.query = event.target.value.toLowerCase().trim();
    renderContent();
  };

  $('#confirmAll').onclick = () => {
    state.data.campaigns.forEach((campaign) => {
      campaign.confirmed = true;
    });
    save();
    render();
  };

  $('#exportJson').onclick = () => {
    download(
      'WB_Promotion_Planner_backup_recalculated.json',
      JSON.stringify(state.data, null, 2),
      'application/json'
    );
  };

  $('#exportCsv').onclick = exportRecommendations;

  $('#importFile').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      state.data = JSON.parse(await file.text());
      recalculateAll();
      render();
    } catch {
      alert('Некорректный JSON-файл');
    }
  };
}

function save() {
  localStorage.setItem('wbPlannerData', JSON.stringify(state.data));
}

function render() {
  renderSummary();
  renderContent();
}

function renderSummary() {
  const data = state.data;
  const eligible = data.conditions.filter((condition) => condition.eligible).length;
  const confirmed = data.campaigns.filter((campaign) => campaign.confirmed).length;

  $('#summary').innerHTML = [
    ['Товаров', data.products.length],
    ['Акций', data.campaigns.length],
    ['Подходящих условий', eligible],
    ['Акций подтверждено', `${confirmed} / ${data.campaigns.length}`]
  ].map(([label, value]) =>
    `<div class="card"><strong>${value}</strong><span>${label}</span></div>`
  ).join('');
}

function matches(...values) {
  return !state.query || values.some((value) =>
    String(value ?? '').toLowerCase().includes(state.query)
  );
}

function table(headers, rows) {
  if (!rows.length) {
    return '<div class="empty">Нет данных для отображения</div>';
  }

  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

function renderContent() {
  const content = $('#content');

  if (state.tab === 'products') content.innerHTML = productsView();
  if (state.tab === 'campaigns') content.innerHTML = campaignsView();
  if (state.tab === 'recommendations') content.innerHTML = recommendationsView();
  if (state.tab === 'inactive') content.innerHTML = inactiveView();
  if (state.tab === 'settings') content.innerHTML = settingsView();

  bindDynamic();
}

function productsView() {
  const rows = state.data.products
    .filter((product) => matches(
      product.sellerArticle,
      product.wbArticle,
      product.name,
      product.brand,
      product.category
    ))
    .map((product) => `
      <tr>
        <td>${esc(product.sellerArticle)}</td>
        <td>${esc(product.wbArticle)}</td>
        <td>${esc(product.name)}</td>
        <td>${esc(product.brand)}</td>
        <td>${money(product.currentRetailPrice)}</td>
        <td>${pct(product.currentDiscount)}</td>
        <td>${money(product.minimumPrice)}</td>
        <td>${product.confirmed ? '<span class="good">Да</span>' : 'Нет'}</td>
      </tr>
    `);

  return table(
    [
      'Артикул продавца',
      'Артикул WB',
      'Товар',
      'Бренд',
      'Эталонная розничная цена',
      'Текущая скидка',
      'Минимальная цена',
      'Подтверждён'
    ],
    rows
  );
}

function campaignsView() {
  const rows = state.data.campaigns
    .filter((campaign) => matches(
      campaign.name,
      campaign.campaignType,
      campaign.sourceFile
    ))
    .map((campaign) => `
      <tr>
        <td>${esc(campaign.name)}</td>
        <td>${esc(campaign.startDate || '—')}</td>
        <td>${esc(campaign.endDate || '—')}</td>
        <td>${esc(campaign.campaignType || '—')}</td>
        <td>${esc(campaign.participationStatus || '—')}</td>
        <td>${campaign.isAutomatic ? 'Да' : 'Нет'}</td>
        <td>
          ${campaign.confirmed
            ? '<span class="good">Подтверждена</span>'
            : `<button class="button small confirm" data-id="${esc(campaign.id)}">Подтвердить</button>`
          }
        </td>
      </tr>
    `);

  return table(
    ['Акция', 'Начало', 'Окончание', 'Тип', 'Статус участия', 'Автоматическая', 'Подтверждение'],
    rows
  );
}

function getRecommendationRows() {
  const campaigns = Object.fromEntries(
    state.data.campaigns.map((campaign) => [campaign.id, campaign])
  );

  return state.data.conditions
    .map((condition) => ({
      ...condition,
      campaign: campaigns[condition.campaignId]
    }))
    .filter((condition) => matches(
      condition.sellerArticle,
      condition.campaign?.name
    ))
    .sort((a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      Number(b.deviationFromMinimum ?? -Infinity) -
      Number(a.deviationFromMinimum ?? -Infinity)
    );
}

function recommendationsView() {
  const rows = getRecommendationRows().map((condition) => `
    <tr>
      <td>${esc(condition.sellerArticle)}</td>
      <td>${esc(condition.campaign?.name || condition.campaignId)}</td>
      <td>${money(condition.currentRetailPrice)}</td>
      <td>${money(condition.plannedCampaignPrice)}</td>
      <td>${money(condition.minimumPrice)}</td>
      <td>${pct(condition.requiredUploadedDiscount)}</td>
      <td class="${condition.eligible ? 'good' : 'bad'}">
        ${condition.eligible ? 'Участвовать' : 'Не участвовать'}
      </td>
      <td class="${Number(condition.deviationFromMinimum) < 0 ? 'bad' : 'good'}">
        ${money(condition.deviationFromMinimum)}
      </td>
      <td>${esc((condition.rejectionReasons || []).join('; '))}</td>
    </tr>
  `);

  return `
    <div class="note">
      Условие участия: цена акции не ниже минимальной цены, а требуемая скидка не превышает ${pct(getMaxDiscount())}.
    </div>
    ${table(
      [
        'Артикул',
        'Акция',
        'Розничная цена',
        'Цена акции',
        'Минимальная цена',
        'Требуемая скидка',
        'Рекомендация',
        'Отклонение от минимума',
        'Причина'
      ],
      rows
    )}
  `;
}

function inactiveView() {
  const now = new Date(state.data.savedAt || Date.now());
  const campaigns = Object.fromEntries(
    state.data.campaigns.map((campaign) => [campaign.id, campaign])
  );

  const byArticle = {};
  state.data.conditions.forEach((condition) => {
    (byArticle[condition.sellerArticle] ??= []).push(condition);
  });

  const rows = state.data.products
    .filter((product) => matches(product.sellerArticle, product.name))
    .map((product) => {
      const conditions = byArticle[product.sellerArticle] || [];
      const eligiblePast = conditions.filter((condition) => {
        const endDate = campaigns[condition.campaignId]?.endDate;
        return endDate && new Date(endDate) < now && condition.eligible;
      });

      const last = eligiblePast.sort((a, b) =>
        new Date(campaigns[b.campaignId].endDate) -
        new Date(campaigns[a.campaignId].endDate)
      )[0];

      const lastDate = last
        ? new Date(campaigns[last.campaignId].endDate)
        : null;

      const days = lastDate
        ? Math.floor((now - lastDate) / 86400000)
        : 9999;

      const best = [...conditions].sort((a, b) =>
        Math.abs(Number(a.deviationFromMinimum ?? Infinity)) -
        Math.abs(Number(b.deviationFromMinimum ?? Infinity))
      )[0];

      return { product, days, best };
    })
    .filter((item) => item.days > 7)
    .map(({ product, days, best }) => {
      const deficit = best
        ? Math.max(0, Number(best.minimumPrice) - Number(best.plannedCampaignPrice))
        : null;

      const deficitPercent = (
        best &&
        Number(best.minimumPrice) > 0
      ) ? deficit / Number(best.minimumPrice) * 100 : null;

      return `
        <tr>
          <td>${esc(product.sellerArticle)}</td>
          <td>${esc(product.name)}</td>
          <td>${days === 9999 ? 'Нет истории' : days}</td>
          <td>${esc(best ? campaigns[best.campaignId]?.name : '—')}</td>
          <td>${money(best?.plannedCampaignPrice)}</td>
          <td>${money(best?.minimumPrice)}</td>
          <td class="${Number(deficit) > 0 ? 'bad' : 'good'}">${money(deficit)}</td>
          <td class="${Number(deficitPercent) > 0 ? 'bad' : 'good'}">${pct(deficitPercent)}</td>
        </tr>
      `;
    });

  return table(
    [
      'Артикул',
      'Товар',
      'Дней без акции',
      'Подобранная акция',
      'Требуемая цена',
      'Минимальная цена',
      'Уход ниже минимума, ₽',
      'Уход ниже минимума, %'
    ],
    rows
  );
}

function settingsView() {
  const settings = state.data.settings || {};

  return `
    <div class="settings">
      <label class="field">
        Максимальная скидка, %
        <input
          data-setting="maxDiscount"
          type="number"
          step="0.1"
          value="${settings.maxDiscount ?? 46.5}"
        >
      </label>

      <label class="field">
        Допустимое отклонение, %
        <input
          data-setting="allowedDeviation"
          type="number"
          step="0.1"
          value="${settings.allowedDeviation ?? 0}"
        >
      </label>

      <label class="field">
        Стратегия
        <select data-setting="strategy">
          <option
            value="max-campaigns"
            ${settings.strategy === 'max-campaigns' ? 'selected' : ''}
          >
            Максимальный охват акций
          </option>
          <option
            value="minPriceProtection"
            ${settings.strategy === 'minPriceProtection' ? 'selected' : ''}
          >
            Защита минимальной цены
          </option>
        </select>
      </label>

      <label class="field">
        Часовой пояс
        <input
          data-setting="timezone"
          value="${esc(settings.timezone || 'Europe/Vienna')}"
        >
      </label>

      <button id="recalculate" class="button">Пересчитать все условия</button>
      <button id="resetData" class="button secondary">Сбросить локальные данные</button>
    </div>
  `;
}

function bindDynamic() {
  document.querySelectorAll('.confirm').forEach((button) => {
    button.onclick = () => {
      const campaign = state.data.campaigns.find(
        (item) => item.id === button.dataset.id
      );
      if (campaign) campaign.confirmed = true;
      save();
      render();
    };
  });

  document.querySelectorAll('[data-setting]').forEach((input) => {
    input.onchange = () => {
      state.data.settings ??= {};
      state.data.settings[input.dataset.setting] =
        input.type === 'number' ? Number(input.value) : input.value;

      recalculateAll();
      render();
    };
  });

  const recalculateButton = $('#recalculate');
  if (recalculateButton) {
    recalculateButton.onclick = () => {
      recalculateAll();
      render();
    };
  }

  const resetButton = $('#resetData');
  if (resetButton) {
    resetButton.onclick = () => {
      localStorage.removeItem('wbPlannerData');
      location.reload();
    };
  }
}

function download(name, content, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportRecommendations() {
  const headers = [
    'Артикул продавца',
    'Акция',
    'Эталонная розничная цена',
    'Цена акции',
    'Минимальная цена',
    'Рекомендуемая скидка',
    'Рекомендация',
    'Отклонение от минимума',
    'Причина'
  ];

  const rows = getRecommendationRows().map((condition) => [
    condition.sellerArticle,
    condition.campaign?.name || '',
    condition.currentRetailPrice,
    condition.plannedCampaignPrice,
    condition.minimumPrice,
    condition.requiredUploadedDiscount,
    condition.eligible ? 'Участвовать' : 'Не участвовать',
    condition.deviationFromMinimum,
    (condition.rejectionReasons || []).join('; ')
  ]);

  const csv = '\ufeff' + [headers, ...rows]
    .map((row) =>
      row.map((value) =>
        '"' + String(value ?? '').replaceAll('"', '""') + '"'
      ).join(';')
    )
    .join('\n');

  download(
    'Рекомендации_WB.csv',
    csv,
    'text/csv;charset=utf-8'
  );
}

init().catch((error) => {
  $('#content').innerHTML =
    `<div class="empty">Ошибка загрузки: ${esc(error.message)}</div>`;
});
"""

out = Path('/mnt/data/app.js')
out.write_text(app_js, encoding='utf-8')
print(f"Создан файл: {out} ({out.stat().st_size} байт)")
