const { Markup } = require("telegraf");
const { formatMoney, formatStrike } = require("../utils/money");

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("New alert", "menu:new"), Markup.button.callback("Alerts", "menu:alerts")],
    [Markup.button.callback("Check now", "menu:check"), Markup.button.callback("Help", "menu:help")]
  ]);
}

function tickerKeyboard(tickers) {
  const rows = [];
  for (let index = 0; index < tickers.length; index += 2) {
    rows.push(tickers.slice(index, index + 2).map((ticker) => (
      Markup.button.callback(ticker.symbol, `new:ticker:${ticker.symbol}`)
    )));
  }
  rows.push([Markup.button.callback("Cancel", "new:cancel")]);
  return Markup.inlineKeyboard(rows);
}

function optionTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Call", "new:type:call"), Markup.button.callback("Put", "new:type:put")],
    [Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]
  ]);
}

function expirationKeyboard(expirations, page) {
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(expirations.length / pageSize));
  const safePage = clampPage(page, totalPages);
  const start = safePage * pageSize;
  const rows = chunk(expirations.slice(start, start + pageSize), 2)
    .map((row) => row.map((expiry) => Markup.button.callback(expiry, `new:exp:${expiry}`)));

  rows.push(pageButtons("new:expPage", safePage, totalPages));
  rows.push([Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]);

  return Markup.inlineKeyboard(rows.filter((row) => row.length > 0));
}

function strikeKeyboard(strikes, page) {
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(strikes.length / pageSize));
  const safePage = clampPage(page, totalPages);
  const start = safePage * pageSize;
  const rows = chunk(strikes.slice(start, start + pageSize).map((strike, offset) => ({
    strike,
    index: start + offset
  })), 3).map((row) => row.map((item) => (
    Markup.button.callback(formatStrike(item.strike), `new:str:${item.index}`)
  )));

  rows.push(pageButtons("new:strPage", safePage, totalPages));
  rows.push([Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]);

  return Markup.inlineKeyboard(rows.filter((row) => row.length > 0));
}

function disambiguationKeyboard(contracts) {
  const rows = contracts.slice(0, 20).map((contract, index) => [
    Markup.button.callback(contract.ticker, `new:contract:${index}`)
  ]);
  rows.push([Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]);
  return Markup.inlineKeyboard(rows);
}

function conditionKindKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("% change from entry", "new:kind:percent_change_from_entry")],
    [Markup.button.callback("$ change from entry", "new:kind:absolute_change_from_entry")],
    [Markup.button.callback("Target option price", "new:kind:target_price")],
    [Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]
  ]);
}

function directionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Above / Up", "new:dir:above"), Markup.button.callback("Below / Down", "new:dir:below")],
    [Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Confirm", "new:confirm")],
    [Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]
  ]);
}

function alertActionsKeyboard(alert) {
  const pauseResume = alert.active
    ? Markup.button.callback("Pause", `al:pause:${alert.id}`)
    : Markup.button.callback("Resume", `al:resume:${alert.id}`);

  return Markup.inlineKeyboard([
    [pauseResume, Markup.button.callback("Check now", `al:check:${alert.id}`)],
    [Markup.button.callback("Edit threshold", `al:th:${alert.id}`), Markup.button.callback("Edit entry", `al:entry:${alert.id}`)],
    [Markup.button.callback("Delete", `al:del:${alert.id}`)]
  ]);
}

function deleteConfirmKeyboard(alertId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Delete", `al:delok:${alertId}`), Markup.button.callback("Keep", `al:delno:${alertId}`)]
  ]);
}

function checkNowKeyboard(alertId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Check now", `al:check:${alertId}`)],
    [Markup.button.callback("Alerts", "menu:alerts")]
  ]);
}

function backCancelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Back", "new:back"), Markup.button.callback("Cancel", "new:cancel")]
  ]);
}

function pageButtons(prefix, page, totalPages) {
  if (totalPages <= 1) return [];

  const buttons = [];
  if (page > 0) buttons.push(Markup.button.callback("Prev", `${prefix}:${page - 1}`));
  buttons.push(Markup.button.callback(`${page + 1}/${totalPages}`, `${prefix}:${page}`));
  if (page < totalPages - 1) buttons.push(Markup.button.callback("Next", `${prefix}:${page + 1}`));
  return buttons;
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function clampPage(page, totalPages) {
  return Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
}

module.exports = {
  mainMenuKeyboard,
  tickerKeyboard,
  optionTypeKeyboard,
  expirationKeyboard,
  strikeKeyboard,
  disambiguationKeyboard,
  conditionKindKeyboard,
  directionKeyboard,
  confirmKeyboard,
  alertActionsKeyboard,
  deleteConfirmKeyboard,
  checkNowKeyboard,
  backCancelKeyboard
};
