const DEFAULT_TICKERS = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corporation" },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "TSLA", name: "Tesla, Inc." },
  { symbol: "SPY", name: "S&P 500 ETF" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF" }
];

const RECENT_TICKERS_KEY = "optionsHistoryRecentTickers";
const MAX_TICKER_PICKS = 10;

const state = {
  expirations: [],
  strikes: [],
  history: null,
  chartPoints: [],
  underlyingChartPoints: [],
  hoverTimeMs: null,
  chartModel: null,
  tickerPicks: buildTickerPicks()
};

const API_BASE = normalizeApiBase(window.OPTIONS_API_BASE || defaultApiBase());

const els = {
  form: document.querySelector("#historyForm"),
  serverStatus: document.querySelector("#serverStatus"),
  underlyingSymbol: document.querySelector("#underlyingSymbol"),
  expirationDate: document.querySelector("#expirationDate"),
  strikeSelect: document.querySelector("#strikeSelect"),
  strikePrice: document.querySelector("#strikePrice"),
  fromDate: document.querySelector("#fromDate"),
  toDate: document.querySelector("#toDate"),
  timespan: document.querySelector("#timespan"),
  loadExpiriesButton: document.querySelector("#loadExpiriesButton"),
  loadHistoryButton: document.querySelector("#loadHistoryButton"),
  tickerQuickPicks: document.querySelector("#tickerQuickPicks"),
  exportCsvLink: document.querySelector("#exportCsvLink"),
  chart: document.querySelector("#priceChart"),
  chartTitle: document.querySelector("#chartTitle"),
  chartSubtitle: document.querySelector("#chartSubtitle"),
  cacheStatus: document.querySelector("#cacheStatus"),
  hoverReadout: document.querySelector("#hoverReadout"),
  contractMetric: document.querySelector("#contractMetric"),
  barsMetric: document.querySelector("#barsMetric"),
  lastMetric: document.querySelector("#lastMetric"),
  volumeMetric: document.querySelector("#volumeMetric"),
  deltaMetric: document.querySelector("#deltaMetric"),
  snapshotList: document.querySelector("#snapshotList"),
  tableCount: document.querySelector("#tableCount"),
  historyTableBody: document.querySelector("#historyTableBody")
};

setDefaultDates();
renderTickerPicks();
bindEvents();
drawChart();

function bindEvents() {
  els.loadExpiriesButton.addEventListener("click", loadExpirations);
  els.underlyingSymbol.addEventListener("input", renderTickerPicks);
  els.tickerQuickPicks.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-ticker]");
    if (!button) return;
    selectTicker(button.dataset.ticker);
  });
  els.expirationDate.addEventListener("change", loadStrikes);
  els.strikeSelect.addEventListener("change", () => {
    if (els.strikeSelect.value) {
      els.strikePrice.value = els.strikeSelect.value;
    }
  });
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadHistory();
  });
  els.chart.addEventListener("mousemove", handleChartHover);
  els.chart.addEventListener("mouseleave", () => {
    state.hoverTimeMs = null;
    els.hoverReadout.hidden = true;
    drawChart();
  });
  window.addEventListener("resize", drawChart);
}

async function loadExpirations() {
  const underlyingSymbol = normalizedTicker();
  const contractType = selectedContractType();
  if (!underlyingSymbol) {
    setStatus("Enter a ticker", true);
    return;
  }

  setBusy(els.loadExpiriesButton, true);
  setStatus("Loading expiries");
  resetSelect(els.expirationDate, "Loading...");
  resetSelect(els.strikeSelect, "Select expiry first");

  try {
    const data = await getJson(apiUrl(`expirations?${query({ underlyingSymbol, contractType })}`));
    state.expirations = data.expirations || [];
    fillSelect(els.expirationDate, state.expirations, "Select expiry");
    els.expirationDate.disabled = state.expirations.length === 0;
    setCacheStatus(data.cache);
    setStatus(state.expirations.length ? "Expiries loaded" : "No expiries found");

    if (state.expirations.length > 0) {
      rememberTicker(underlyingSymbol);
      els.expirationDate.value = state.expirations[0];
      await loadStrikes();
    }
  } catch (error) {
    resetSelect(els.expirationDate, "Could not load expiries");
    setStatus(error.message, true);
  } finally {
    setBusy(els.loadExpiriesButton, false);
  }
}

async function loadStrikes() {
  const underlyingSymbol = normalizedTicker();
  const contractType = selectedContractType();
  const expirationDate = els.expirationDate.value;
  if (!underlyingSymbol || !expirationDate) return;

  resetSelect(els.strikeSelect, "Loading...");
  els.strikeSelect.disabled = true;
  setStatus("Loading strikes");

  try {
    const data = await getJson(apiUrl(`strikes?${query({ underlyingSymbol, contractType, expirationDate })}`));
    state.strikes = data.strikes || [];
    fillSelect(els.strikeSelect, state.strikes, "Select strike");
    els.strikeSelect.disabled = state.strikes.length === 0;
    setCacheStatus(data.cache);
    setStatus(state.strikes.length ? "Strikes loaded" : "No strikes found");

    if (state.strikes.length > 0) {
      const middle = Math.floor(state.strikes.length / 2);
      els.strikeSelect.value = state.strikes[middle];
      els.strikePrice.value = state.strikes[middle];
    }
  } catch (error) {
    resetSelect(els.strikeSelect, "Could not load strikes");
    setStatus(error.message, true);
  }
}

async function loadHistory() {
  const params = currentHistoryParams();
  if (!params) return;

  setBusy(els.loadHistoryButton, true);
  setStatus("Loading history");
  disableExport();

  try {
    const data = await getJson(apiUrl(`history?${query(params)}`));
    state.history = data;
    state.chartPoints = chartableBars(data.bars || []);
    state.underlyingChartPoints = chartableBars(data.underlyingBars || []);
    state.hoverTimeMs = null;
    updateSummary(data);
    updateSnapshot(data.snapshot);
    updateTable(data.bars || []);
    updateExport(params);
    rememberTicker(params.underlyingSymbol);
    drawChart();
    setCacheStatus(data.cache && data.cache.history);
    setStatus(data.bars.length ? "History loaded" : "No bars returned");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(els.loadHistoryButton, false);
  }
}

function currentHistoryParams() {
  const underlyingSymbol = normalizedTicker();
  const contractType = selectedContractType();
  const expirationDate = els.expirationDate.value;
  const strikePrice = Number(els.strikePrice.value);
  const from = els.fromDate.value;
  const to = els.toDate.value;
  const timespan = els.timespan.value;

  if (!underlyingSymbol) {
    setStatus("Enter a ticker", true);
    return null;
  }
  if (!expirationDate) {
    setStatus("Select an expiry", true);
    return null;
  }
  if (!Number.isFinite(strikePrice) || strikePrice <= 0) {
    setStatus("Enter a positive strike", true);
    return null;
  }
  if (!from || !to) {
    setStatus("Select a date range", true);
    return null;
  }

  return {
    underlyingSymbol,
    contractType,
    expirationDate,
    strikePrice,
    from,
    to,
    timespan,
    multiplier: 1
  };
}

function updateSummary(data) {
  const bars = data.bars || [];
  const lastBar = bars[bars.length - 1] || null;
  const contract = data.contract || {};

  els.contractMetric.textContent = contract.optionContract || "No contract loaded";
  els.barsMetric.textContent = String(bars.length);
  els.lastMetric.textContent = lastBar ? money(lastBar.last) : "-";
  els.volumeMetric.textContent = lastBar ? number(lastBar.volume) : "-";
  els.deltaMetric.textContent = data.snapshot ? decimal(data.snapshot.delta, 4) : "-";

  els.chartTitle.textContent = contract.optionContract || "Last price history";
  const subtitle = [
    contract.underlyingSymbol,
    contract.contractType,
    contract.expirationDate,
    contract.strikePrice ? `strike ${formatStrike(contract.strikePrice)}` : null
  ].filter(Boolean).join(" / ");
  els.chartSubtitle.textContent = subtitle
    ? `${subtitle} / option left axis, underlying right axis`
    : "Option and underlying aggregate close prices.";
}

function updateSnapshot(snapshot) {
  const values = [
    ["Delta", decimal(snapshot && snapshot.delta, 4)],
    ["Gamma", decimal(snapshot && snapshot.gamma, 4)],
    ["Theta", decimal(snapshot && snapshot.theta, 4)],
    ["Vega", decimal(snapshot && snapshot.vega, 4)],
    ["IV", percentFromDecimal(snapshot && snapshot.impliedVolatility)],
    ["Open interest", number(snapshot && snapshot.openInterest)]
  ];

  els.snapshotList.innerHTML = values.map(([label, value]) => (
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  )).join("");
}

function updateTable(bars) {
  const rows = bars.slice(-120).reverse();
  els.tableCount.textContent = `${bars.length} row${bars.length === 1 ? "" : "s"}`;

  if (rows.length === 0) {
    els.historyTableBody.innerHTML = '<tr><td colspan="8" class="empty-cell">No bars returned for this range.</td></tr>';
    return;
  }

  els.historyTableBody.innerHTML = rows.map((bar) => `
    <tr>
      <td>${escapeHtml(shortDate(bar.datetime))}</td>
      <td>${escapeHtml(money(bar.open))}</td>
      <td>${escapeHtml(money(bar.high))}</td>
      <td>${escapeHtml(money(bar.low))}</td>
      <td>${escapeHtml(money(bar.last))}</td>
      <td>${escapeHtml(number(bar.volume))}</td>
      <td>${escapeHtml(money(bar.vwap))}</td>
      <td>${escapeHtml(number(bar.transactions))}</td>
    </tr>
  `).join("");
}

function updateExport(params) {
  els.exportCsvLink.href = apiUrl(`history.csv?${query(params)}`);
  els.exportCsvLink.classList.remove("disabled");
  els.exportCsvLink.setAttribute("aria-disabled", "false");
}

function disableExport() {
  els.exportCsvLink.href = "#";
  els.exportCsvLink.classList.add("disabled");
  els.exportCsvLink.setAttribute("aria-disabled", "true");
}

function drawChart() {
  const optionPoints = state.chartPoints;
  const underlyingPoints = state.underlyingChartPoints;
  const canvas = els.chart;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pad = { top: 22, right: 76, bottom: 42, left: 62 };
  const plot = {
    x: pad.left,
    y: pad.top,
    width: Math.max(1, rect.width - pad.left - pad.right),
    height: Math.max(1, rect.height - pad.top - pad.bottom)
  };

  ctx.fillStyle = "#fbfcfa";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#d9ded6";
  ctx.lineWidth = 1;
  ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);

  const allPoints = [...optionPoints, ...underlyingPoints];
  if (!allPoints.length) {
    state.chartModel = null;
    ctx.fillStyle = "#637066";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Load a contract to draw the chart", rect.width / 2, rect.height / 2);
    return;
  }

  const times = allPoints.map((point) => point.timestampMs).filter(Number.isFinite);
  let xMin = Math.min(...times);
  let xMax = Math.max(...times);
  if (xMin === xMax) {
    xMin -= 30 * 60 * 1000;
    xMax += 30 * 60 * 1000;
  }

  const optionAxis = axisFor(optionPoints.map((point) => point.last));
  const underlyingAxis = axisFor(underlyingPoints.map((point) => point.last));
  state.chartModel = { plot, xMin, xMax, optionAxis, underlyingAxis };

  drawGrid(ctx, plot, optionAxis, underlyingAxis);
  drawSeries(ctx, optionPoints, xMin, xMax, optionAxis, plot, "#1b7f5f");
  drawSeries(ctx, underlyingPoints, xMin, xMax, underlyingAxis, plot, "#276fbf");

  if (state.hoverTimeMs !== null) {
    const x = xForTime(state.hoverTimeMs, xMin, xMax, plot);
    ctx.strokeStyle = "rgba(179, 58, 58, 0.65)";
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
    ctx.stroke();

    drawHoverPoint(ctx, nearestPoint(optionPoints, state.hoverTimeMs), xMin, xMax, optionAxis, plot, "#1b7f5f");
    drawHoverPoint(ctx, nearestPoint(underlyingPoints, state.hoverTimeMs), xMin, xMax, underlyingAxis, plot, "#276fbf");
  }
}

function drawGrid(ctx, plot, optionAxis, underlyingAxis) {
  const gridAxis = optionAxis || underlyingAxis;
  if (!gridAxis) return;

  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const y = plot.y + plot.height * ratio;

    ctx.strokeStyle = "#e8ece6";
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();

    if (optionAxis) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#637066";
      ctx.fillText(money(valueForRatio(ratio, optionAxis)), plot.x - 8, y);
    }

    if (underlyingAxis) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#276fbf";
      ctx.fillText(money(valueForRatio(ratio, underlyingAxis)), plot.x + plot.width + 8, y);
    }
  }
}

function handleChartHover(event) {
  if (!state.chartModel) return;

  const rect = els.chart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const { plot, xMin, xMax } = state.chartModel;
  const clamped = Math.max(plot.x, Math.min(plot.x + plot.width, x));
  const ratio = (clamped - plot.x) / Math.max(1, plot.width);
  const hoverTimeMs = xMin + ratio * (xMax - xMin);

  state.hoverTimeMs = hoverTimeMs;
  els.hoverReadout.hidden = false;
  const maxReadoutLeft = Math.max(8, rect.width - 230);
  els.hoverReadout.style.left = `${Math.min(maxReadoutLeft, Math.max(8, x + 12))}px`;
  els.hoverReadout.style.top = `${Math.max(8, event.clientY - rect.top - 72)}px`;
  els.hoverReadout.innerHTML = hoverReadoutHtml(hoverTimeMs);
  drawChart();
}

function drawSeries(ctx, points, xMin, xMax, axis, plot, color) {
  if (!points.length || !axis) return;

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xForTime(point.timestampMs, xMin, xMax, plot);
    const y = yForValue(point.last, axis, plot);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawHoverPoint(ctx, point, xMin, xMax, axis, plot, color) {
  if (!point || !axis) return;
  const x = xForTime(point.timestampMs, xMin, xMax, plot);
  const y = yForValue(point.last, axis, plot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function xForTime(timestampMs, xMin, xMax, plot) {
  if (xMax === xMin) return plot.x;
  return plot.x + ((timestampMs - xMin) / (xMax - xMin)) * plot.width;
}

function yForValue(value, axis, plot) {
  return plot.y + (1 - (value - axis.min) / (axis.max - axis.min)) * plot.height;
}

function valueForRatio(ratio, axis) {
  return axis.max - (axis.max - axis.min) * ratio;
}

function axisFor(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;

  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);

  if (min === max) {
    const fixedPadding = Math.max(Math.abs(min) * 0.01, 0.5);
    min -= fixedPadding;
    max += fixedPadding;
  } else {
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }

  return { min, max };
}

function chartableBars(bars) {
  return bars
    .map((bar) => {
      const timestampNumber = Number(bar.timestamp);
      const timestampMs = Number.isFinite(timestampNumber)
        ? timestampNumber
        : Date.parse(bar.datetime);
      const last = bar.last === null || bar.last === undefined ? null : Number(bar.last);
      return {
        ...bar,
        timestampMs,
        last
      };
    })
    .filter((bar) => Number.isFinite(bar.timestampMs) && Number.isFinite(bar.last))
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

function nearestPoint(points, timestampMs) {
  if (!points.length || !Number.isFinite(timestampMs)) return null;

  let nearest = points[0];
  let nearestDistance = Math.abs(points[0].timestampMs - timestampMs);

  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index].timestampMs - timestampMs);
    if (distance < nearestDistance) {
      nearest = points[index];
      nearestDistance = distance;
    }
  }

  return nearest;
}

function hoverReadoutHtml(hoverTimeMs) {
  const optionPoint = nearestPoint(state.chartPoints, hoverTimeMs);
  const underlyingPoint = nearestPoint(state.underlyingChartPoints, hoverTimeMs);

  return [
    `<strong>${escapeHtml(shortDate(new Date(hoverTimeMs).toISOString()))}</strong>`,
    optionPoint
      ? `<span class="readout-option">Option ${escapeHtml(money(optionPoint.last))}</span> <span>Vol ${escapeHtml(number(optionPoint.volume))}</span>`
      : null,
    underlyingPoint
      ? `<span class="readout-underlying">Underlying ${escapeHtml(money(underlyingPoint.last))}</span> <span>Vol ${escapeHtml(number(underlyingPoint.volume))}</span>`
      : null
  ].filter(Boolean).join("<br>");
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function query(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, value);
    }
  });
  return search.toString();
}

function apiUrl(path) {
  return `${API_BASE}/${String(path).replace(/^\/+/, "")}`;
}

function normalizeApiBase(value) {
  const base = String(value || "api").trim() || "api";
  return base.replace(/\/+$/, "");
}

function defaultApiBase() {
  const publicMarker = "/www/public/";
  const pathname = window.location.pathname;
  const publicIndex = pathname.indexOf(publicMarker);

  if (publicIndex !== -1) {
    const prefix = pathname.slice(0, publicIndex);
    return `${prefix || ""}/api`;
  }

  return "api";
}

function fillSelect(select, values, placeholder) {
  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(String(value))}">${escapeHtml(formatStrike(value))}</option>`)
  ].join("");
}

function resetSelect(select, label) {
  select.innerHTML = `<option value="">${escapeHtml(label)}</option>`;
  select.disabled = true;
}

function setBusy(button, isBusy) {
  button.disabled = isBusy;
}

function setStatus(message, isError = false) {
  els.serverStatus.textContent = message;
  els.serverStatus.classList.toggle("is-error", Boolean(isError));
}

function setCacheStatus(cache) {
  if (!cache) {
    els.cacheStatus.textContent = "No cache";
    return;
  }
  els.cacheStatus.textContent = cache.hit ? "Cache hit" : "Fresh fetch";
}

function selectTicker(symbol) {
  const ticker = cleanTicker(symbol);
  if (!ticker) return;

  const changed = cleanTicker(els.underlyingSymbol.value) !== ticker;
  els.underlyingSymbol.value = ticker;

  if (changed) {
    resetSelect(els.expirationDate, "Load expiries first");
    resetSelect(els.strikeSelect, "Select expiry first");
    els.strikePrice.value = "";
    disableExport();
  }

  renderTickerPicks();
  setStatus("Ticker selected");
}

function renderTickerPicks() {
  if (!els.tickerQuickPicks) return;

  const activeTicker = cleanTicker(els.underlyingSymbol.value);
  els.tickerQuickPicks.innerHTML = state.tickerPicks.map((ticker) => {
    const isActive = ticker.symbol === activeTicker;
    const title = ticker.name ? `${ticker.symbol} - ${ticker.name}` : ticker.symbol;
    return `
      <button
        type="button"
        class="ticker-chip${isActive ? " is-active" : ""}"
        data-ticker="${escapeHtml(ticker.symbol)}"
        title="${escapeHtml(title)}"
      >${escapeHtml(ticker.symbol)}</button>
    `;
  }).join("");
}

function rememberTicker(symbol) {
  const ticker = cleanTicker(symbol);
  if (!isTickerLike(ticker)) return;

  const recent = [
    ticker,
    ...loadRecentTickers().map((item) => item.symbol).filter((item) => item !== ticker)
  ].slice(0, MAX_TICKER_PICKS);

  try {
    window.localStorage.setItem(RECENT_TICKERS_KEY, JSON.stringify(recent));
  } catch (error) {
    return;
  }

  state.tickerPicks = buildTickerPicks();
  renderTickerPicks();
}

function buildTickerPicks() {
  return mergeTickerLists(loadRecentTickers(), DEFAULT_TICKERS).slice(0, MAX_TICKER_PICKS);
}

function loadRecentTickers() {
  let parsed;
  try {
    parsed = JSON.parse(window.localStorage.getItem(RECENT_TICKERS_KEY) || "[]");
  } catch (error) {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (typeof item === "string") return { symbol: cleanTicker(item), name: "" };
      if (item && typeof item === "object") {
        return {
          symbol: cleanTicker(item.symbol),
          name: typeof item.name === "string" ? item.name : ""
        };
      }
      return null;
    })
    .filter((item) => item && isTickerLike(item.symbol));
}

function mergeTickerLists(...lists) {
  const seen = new Set();
  const merged = [];

  lists.flat().forEach((ticker) => {
    const symbol = cleanTicker(ticker && ticker.symbol);
    if (!isTickerLike(symbol) || seen.has(symbol)) return;
    seen.add(symbol);
    merged.push({
      symbol,
      name: typeof ticker.name === "string" ? ticker.name : ""
    });
  });

  return merged;
}

function normalizedTicker() {
  const value = cleanTicker(els.underlyingSymbol.value);
  els.underlyingSymbol.value = value;
  renderTickerPicks();
  return value;
}

function cleanTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function isTickerLike(value) {
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(value);
}

function selectedContractType() {
  return document.querySelector('input[name="contractType"]:checked').value;
}

function setDefaultDates() {
  const today = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 90);
  els.toDate.value = today.toISOString().slice(0, 10);
  els.fromDate.value = from.toISOString().slice(0, 10);
}

function money(value) {
  if (!Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

function number(value) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function decimal(value, places) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(places);
}

function percentFromDecimal(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function formatStrike(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return Number.isInteger(numberValue)
    ? String(numberValue)
    : String(Math.round(numberValue * 10000) / 10000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
