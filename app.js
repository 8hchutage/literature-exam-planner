import { requestPlan } from "./pages-storage.js";
import { courseTasks, groups, isSection, libraryResources, localDay, mergeBackup, milestoneColors, milestoneLevels, milestoneStyle, monthPeriods, referenceResources, resourceFolderIndex, stats, statuses, taskIndex } from "./model.js";

const main = document.querySelector("#main");
const dialog = document.querySelector("#editor");
const notice = document.querySelector("#notice");
const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const attrs = (values) => Object.entries(values).map(([k,v]) => ' data-' + k + '="' + esc(v) + '"').join("");
const button = (label, cmd, data = {}, extra = "") => '<button type="button" data-cmd="' + cmd + '"' + attrs(data) + " " + extra + ">" + label + "</button>";
const noteToggle = (note) => note ? button('<span aria-hidden="true">💬︎</span>', "toggleNote", {},
  'class="note-toggle" aria-expanded="false" aria-label="备注" title="备注"') : "";
const input = (label, name, value, options = "") => "<label>" + label + '<input name="' + name + '" value="' + esc(value) + '" ' + options + "></label>";
const area = (label, name, value, options = "") => "<label>" + label + '<textarea rows="3" name="' + name + '"' +
  (options ? " " + options : "") + ">" + esc(value) + "</textarea></label>";
const select = (label, name, options, value) => "<label>" + label + '<select name="' + name + '">' + options.map(([key, text]) =>
  '<option value="' + esc(key) + '"' + (String(key) === String(value) ? " selected" : "") + ">" + esc(text) + "</option>").join("") + "</select></label>";
const form = (action, fields, id = "") => '<form data-action="' + action + '" data-id="' + esc(id) + '">' + fields + '<p class="form-error" role="alert" hidden></p><div><button class="primary">保存</button></div></form>';
const heading = (title, sub, action = "") => '<header class="pagehead"><div><h1>' + esc(title) + '</h1><p class="quiet">' + esc(sub) + "</p></div>" + action + "</header>";
const panel = (html) => '<section class="panel">' + html + "</section>";
const empty = (msg) => '<p class="empty">' + esc(msg) + "</p>";
const hours = (num) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(num) + " h";
const shifted = (date, days) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const today = () => localDay();
const statusTag = (status) => '<span class="tag ' + (status === "REVIEW" ? "review" : "") + '">' + statuses[status] + "</span>";
let saved, busy = false, noticeTimer, drag, renderedRoute, pinnedModule = "";
let selected = today(), calendarMode = "month";
let timelineColor = "";
let timelineOpen = true;
let libraryArchiveOpen = false;
const timelineColors = [["", "全部颜色"], ["gray", "灰褐"], ...Object.entries(milestoneColors).filter(([color]) => color !== "auto")];
const filters = { status: "OPEN", module: "", priority: "0", due: "" };
const expanded = new Set();
const folderViewKey = "literature-planner:open-resource-folders";
const openFolders = new Set();
try {
  const stored = JSON.parse(localStorage.getItem(folderViewKey) ?? "[]");
  if (Array.isArray(stored)) for (const id of stored) openFolders.add(id);
} catch {
  // Folder expansion is optional device-local UI state.
}
const current = () => saved.plan;
const moduleName = (id) => current().modules.find((item) => item.id === id)?.name ?? "";
const allModules = () => current().modules.map((item) => [item.id, item.name + (item.archived ? "（已归档）" : "")]);
const taskOptions = (moduleId, { includeSections = false, currentId } = {}) => {
  const plan = current();
  const index = taskIndex(plan.tasks);
  const rows = [];
  function visit(id, depth) {
    for (const task of index.siblings(id)) {
      if (!isSection(task) || includeSections || task.id === currentId) {
        rows.push([task.id, "\u00a0\u00a0".repeat(depth) + (depth ? "└ " : "") + task.name +
          (isSection(task) ? "（小板块）" : "")]);
      }
      visit(task.id, depth + 1);
    }
  }
  visit(moduleId, 0);
  return rows;
};

function flash(message) {
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ""; }, 4500);
}

async function load() {
  const response = await requestPlan({ cache: "no-store" });
  if (response.status === 401) {
    main.innerHTML = heading("文学考研备考规划", "登录后读取你的个人备考计划。") +
      '<a class="button primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">登录后继续</a>';
    return;
  }
  if (!response.ok) throw new Error("暂时无法打开此浏览器的学习记录，请检查浏览器存储设置后重试。");
  saved = await response.json();
  render();
}

async function save(action, data, errorNode) {
  if (busy) return;
  busy = true;
  const editorForm = dialog.open ? dialog.querySelector("form") : null;
  const draft = editorForm ? [...new FormData(editorForm)] : null;
  const focus = document.activeElement;
  if (focus instanceof HTMLButtonElement) focus.disabled = true;
  try {
    const response = await requestPlan({
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data, revision: saved.revision }),
    });
    const result = await response.json();
    if (response.status === 409) {
      await load();
      if (draft && dialog.open) {
        for (const [key, value] of draft) {
          const field = editorForm.elements.namedItem(key);
          if (field instanceof HTMLElement && field.type !== "checkbox") field.value = value;
        }
      }
    }
    if (!response.ok) throw new Error(result.error || "保存失败。");
    saved = result;
    if (dialog.open) dialog.close();
    render();
    flash(action === "importBackup" ? "备份已合并，原有记录已保留。" : "已保存");
  } catch (error) {
    if (errorNode?.isConnected) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
    } else flash(error.message);
  } finally {
    busy = false;
    if (focus instanceof HTMLButtonElement && focus.isConnected) focus.disabled = false;
  }
}

function home() {
  const plan = current();
  const { deadline, school } = plan.settings;
  const total = stats(plan.tasks, plan.logs);
  const currentDay = today();
  const days = deadline ? Math.round((Date.parse(deadline) - Date.parse(currentDay)) / 86400000) : null;
  const metric = (number, label) => '<div class="stat"><small>' + label + "</small><strong>" + number + "</strong></div>";
  return heading("文学考研备考规划", school ? school + " · " + (plan.settings.direction || "备考总览") : "从公共课和汉语言文学基础开始，定校后再配置专业课。", '<a class="button" href="#settings">备考设置</a>') +
    '<div class="overview"><section class="hero"><small class="quiet">考试倒计时</small><strong>' +
    (days === null ? "日期待定" : days === 0 ? "今天" : Math.abs(days) + " 天") + '</strong><p class="quiet">' +
    (days === null ? "可先为单项任务设置截止日期" : (days < 0 ? "已过截止日期 · " : "目标日期 · ") + esc(deadline)) +
    '</p><progress aria-label="总完成度" max="100" value="' + total.percent + '"></progress></section><div class="metrics">' +
    metric(total.percent + "%", "总完成度") + metric(total.remaining, "剩余任务") + metric(hours(total.estimated), "预计时长") +
    metric(hours(total.logged), "已投入") + '</div></div>' + fiveDayPlans(plan.dates, currentDay) +
    '<h2>学习板块</h2><div class="cards">' +
    Object.entries(groups).map(([id, name]) => {
      const ids = new Set(plan.modules.filter((item) => item.group === id).map((item) => item.id));
      const progress = stats(plan.tasks.filter((task) => ids.has(task.moduleId)), plan.logs.filter((log) => ids.has(log.moduleId)));
      return '<a class="panel modulecard" href="#tree/' + id + '"><h3>' + name + '</h3><progress aria-label="完成度" max="100" value="' +
        progress.percent + '"></progress><footer><span>' + progress.percent + '%</span><span>已投入 ' + hours(progress.logged) + "</span></footer></a>";
    }).join("") + "</div>";
}

function fiveDayPlans(dates, currentDay) {
  const rows = Array.from({ length: 5 }, (_, offset) => {
    const date = shifted(currentDay, offset - 1);
    const text = dates[date];
    return '<li><time datetime="' + date + '">' + date + '</time>' +
      (text ? '<p class="multiline">' + esc(text) + '</p>' : '<p class="quiet">未填写</p>') + '</li>';
  });
  return panel('<div class="row wrap"><h2 class="recent-plans-title">五天计划</h2>' +
    '<a class="button" href="#journal">学习记录</a></div><ol class="recent-plans">' + rows.join("") + '</ol>');
}

const sortData = (action, id, group) => attrs({ "sort-action": action, "sort-id": id, "sort-group": group });
const sortHandle = (name) => '<button class="sort-handle" type="button" title="拖动排序，也可按上下方向键" aria-label="' +
  esc("排序 " + name) + '" aria-description="拖动手柄，或使用上下方向键调整顺序。"' + attrs({ "sort-label": name }) +
  '><span aria-hidden="true">⠿</span></button>';

function webLink(location) {
  try {
    const url = new URL(location);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function showLocation(location, label = location) {
  const url = webLink(location);
  return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>" : esc(label);
}

function taskReferences(task) {
  const selected = new Set(task.resourceIds ?? []);
  const references = referenceResources(current()).filter((note) => selected.has(note.id)).map((note) =>
    showLocation(note.source, note.title) + (note.source && !webLink(note.source) ? "（" + esc(note.source) + "）" : ""));
  if (task.resource) references.push(showLocation(task.resource));
  return references.length ? '<div class="task-references"><small>参考资料</small><ul>' +
    references.map((item) => "<li>" + item + "</li>").join("") + "</ul></div>" : "";
}

function taskLine(task, inTree = false) {
  const index = taskIndex(current().tasks);
  const path = index.path(task.parentId).map((node) => node.name).join(" › ");
  if (isSection(task)) {
    const open = expanded.has(task.id);
    return '<div class="row task section-row" data-section="' + esc(task.id) + '"' +
      (inTree ? sortData("move", task.id, task.moduleId + "/") + attrs({ "task-module": task.moduleId }) : "") + ">" +
      (inTree ? sortHandle(task.name) : "") + '<div class="body">' +
      (inTree ? button('<span aria-hidden="true">' + (open ? "▾" : "▸") + "</span> " + esc(task.name), "sectionExpand",
        { id: task.id }, 'class="section-toggle" aria-expanded="' + open + '" aria-controls="branch-' + esc(task.id) + '"') :
        "<strong>" + esc(task.name) + "</strong>") +
      ' <span class="tag section-tag">小板块</span>' + taskReferences(task) + '</div><div class="actions">' +
      (inTree ? button("+ 任务", "task", { module: task.moduleId, parent: task.id }) : "") +
      button("编辑", "task", { id: task.id }) + "</div></div>";
  }
  return '<div class="row task" data-task="' + esc(task.id) + '"' +
    (inTree ? sortData("move", task.id, task.moduleId + "/" + (task.parentId ?? "")) + attrs({ "task-module": task.moduleId }) : "") + ">" +
    (inTree ? sortHandle(task.name) : "") +
    button(task.status === "DONE" ? "✓" : "○", "toggle", { id: task.id }, 'class="toggle" aria-label="切换完成状态"') +
    '<div class="body">' + (inTree ? "" : "<small>" + esc([moduleName(task.moduleId), path].filter(Boolean).join(" › ")) + "</small><br>") +
    '<strong class="' + (task.status === "DONE" ? "done" : "") + '">' + esc(task.name) + '</strong> ' + statusTag(task.status) +
    '<div><small>P' + task.priority + " · " + hours(task.hours) + (task.deadline ? " · " + esc(task.deadline) : "") + "</small></div>" +
    taskReferences(task) + "</div>" +
    '<div class="actions">' + (inTree ? button("+ 子任务", "task", { module: task.moduleId, parent: task.id }) : "") +
    button("编辑", "task", { id: task.id }) + "</div></div>";
}

function tree(id) {
  const plan = current(), index = taskIndex(plan.tasks);
  const matched = plan.modules.filter((item) => !item.archived && (!id || item.group === id || item.id === id));
  const branches = (parent) => {
    const siblings = index.siblings(parent);
    return siblings.map((task) => {
      const children = index.siblings(task.id);
      const branch = isSection(task)
        ? '<ul id="branch-' + esc(task.id) + '"' + (expanded.has(task.id) ? "" : " hidden") + ">" +
          (children.length ? branches(task.id) : '<li class="quiet">此板块还没有任务。</li>') + "</ul>"
        : children.length ? '<details data-expand="' + esc(task.id) + '"' + (expanded.has(task.id) ? " open" : "") +
          '><summary>子任务（' + children.length + "）</summary><ul>" + branches(task.id) + "</ul></details>" : "";
      return "<li>" + taskLine(task, true) + branch + "</li>";
    }).join("");
  };
  return heading(groups[id] ?? "任务树", "拖动左侧手柄排序，拖到大板块或小板块标题可移动整个任务分支。", button("+ 学科", "module", {}, 'class="primary"')) +
    matched.map((module) => {
      const open = expanded.has(module.id) || pinnedModule === module.id;
      const branchId = "module-branch-" + esc(module.id);
      const title = esc(module.name) + (module.deadline ? " · " + esc(module.deadline) : "");
      return '<section class="module" data-note-disclosure><div class="module-header"' +
        attrs({ "section-drop": module.id }) + (module.group === "literature" ? sortData("moveModule", module.id, "literature") : "") + ">" +
        (module.group === "literature" ? sortHandle(module.name) : "") +
        button('<span aria-hidden="true">' + (open ? "▾" : "▸") + '</span><span>' + title + '</span>', "sectionExpand",
          { id: module.id }, 'class="section-toggle module-title" aria-expanded="' + open + '" aria-controls="' + branchId + '"') +
        noteToggle(module.note) + '</div>' +
        (module.note ? '<div class="module-note" data-note-text hidden><div class="row wrap"><h3>板块备注</h3><div class="actions">' +
          button("编辑备注", "moduleNote", { id: module.id }) + '</div></div><p class="multiline">' + esc(module.note) + "</p></div>" : "") +
        '<div class="module-body" id="' + branchId + '"' + (open ? "" : " hidden") + '><div class="actions">' +
        button("+ 根任务", "task", { module: module.id }) + button("+ 小板块", "task", { module: module.id, kind: "section" }) +
        button("板块设置", "module", { id: module.id }) +
        (module.note ? "" : button("添加备注", "moduleNote", { id: module.id })) + '</div>' +
        (index.siblings(module.id).length ? '<ul class="tree">' + branches(module.id) + "</ul>" : empty("还没有任务，可以从教材、专题或题型开始拆分。")) +
        "</div></section>";
    }).join("") + (matched.length ? "" : empty("此处没有可用板块。"));
}

function pool() {
  const plan = current();
  const archived = new Set(plan.modules.filter((item) => item.archived).map((item) => item.id));
  const tasks = taskIndex(plan.tasks).leaves.filter((t) => !archived.has(t.moduleId) &&
    (!filters.status || (filters.status === "OPEN" ? t.status !== "DONE" : t.status === filters.status)) &&
    (!filters.module || t.moduleId === filters.module) && t.priority >= Number(filters.priority) &&
    (!filters.due || (t.deadline && t.deadline <= filters.due)))
    .sort((a,b) => b.priority - a.priority || (a.deadline || "z").localeCompare(b.deadline || "z"));
  return heading("任务池", "筛选末级任务，按优先级和截止日期选择下一项。") +
    '<form class="panel filters" data-action="filter">' +
    select("状态", "status", [["OPEN","未完成"], ["","全部"], ...Object.entries(statuses)], filters.status) +
    select("板块", "module", [["","全部"], ...allModules()], filters.module) +
    select("最低优先级", "priority", [["0","不限"], ...[1,2,3,4,5].map((p) => [p,"P" + p])], filters.priority) +
    input("截止到", "due", filters.due, 'type="date"') + '<button class="primary">筛选</button></form>' +
    (tasks.length ? panel(tasks.map((task) => taskLine(task)).join("")) : empty("没有符合条件的任务。"));
}

function milestonePeriodLabel(item) {
  return item.month.slice(0, 4) + "年" + Number(item.month.slice(5)) + "月" + monthPeriods[item.period] + "（暂估）";
}

function milestoneDisplayColor({ importance, color }) {
  return color === "auto" ? (importance === "important" ? "red" : "gray") : color;
}

function milestoneAppearance(item) {
  const style = milestoneStyle(item);
  return attrs({ "milestone-level": style.importance, "milestone-color": milestoneDisplayColor(style) });
}

function milestoneInfo(item) {
  const dateText = item.precision === "period"
    ? esc(milestonePeriodLabel(item))
    : '<time datetime="' + esc(item.date) + '">' + esc(item.date) + '</time>' +
      (item.endDate && item.endDate !== item.date ? ' 至 <time datetime="' + esc(item.endDate) + '">' + esc(item.endDate) + '</time>' : "");
  const important = milestoneStyle(item).importance === "important";
  return '<div class="milestone-info" data-note-disclosure' + milestoneAppearance(item) + '><span class="milestone-date">' + dateText +
    '</span>' + (important ? ' <span class="milestone-badge">重要</span>' : "") +
    '<h3>' + esc(item.name) + noteToggle(item.note) + '</h3>' +
    (item.note ? '<p class="milestone-note multiline" data-note-text hidden>' + esc(item.note) + '</p>' : "") +
    (webLink(item.link) ? showLocation(item.link, "打开相关网站 ↗") : "") + '</div>';
}

function timeline(ordered) {
  const visible = timelineColor ? ordered.filter((item) => milestoneDisplayColor(milestoneStyle(item)) === timelineColor) : ordered;
  return panel('<section aria-labelledby="timeline-title"><div class="row wrap">' +
    '<h2 id="timeline-title">' + button("备考时间轴", "toggleTimeline", {},
      'class="timeline-toggle" aria-controls="timeline-content" aria-expanded="' + timelineOpen + '"') +
    '</h2>' + button("+ 添加节点", "milestone") + '</div>' +
    '<div id="timeline-content"' + (timelineOpen ? "" : " hidden") + '>' +
    '<div class="timeline-filter">' + select("按颜色筛选", "timelineColor", timelineColors, timelineColor) + '</div>' +
    (visible.length ? '<ol class="timeline">' + visible.map((item) =>
      '<li' + milestoneAppearance(item) + '><div class="row wrap">' + milestoneInfo(item) +
      '<div class="actions">' + button("编辑", "milestone", { id: item.id }) +
      button("删除", "removeMilestone", { id: item.id }) + '</div></div></li>').join("") + '</ol>'
      : empty(ordered.length ? "当前颜色下暂无节点。" : "添加报名、初试或复试等重要节点，集中查看备考安排。")) + '</div></section>');
}

function calendarBars(items, firstDay, viewStart) {
  const days = Array.from({ length: 7 }, (_, offset) => shifted(firstDay, offset));
  const lastDay = days[6];
  const lanes = [];
  for (const item of items) {
    const endDate = item.endDate || item.date;
    if (item.date > lastDay || endDate < firstDay) continue;
    const start = days.indexOf(item.date < firstDay ? firstDay : item.date);
    const end = days.indexOf(endDate > lastDay ? lastDay : endDate);
    let lane = lanes.find((row) => row.end < start);
    if (!lane) {
      lane = { end: -1, bars: [] };
      lanes.push(lane);
    }
    lane.end = end;
    const continuesFrom = item.date < firstDay;
    const continuesTo = endDate > lastDay;
    const estimated = item.precision === "period";
    const classes = ["calendar-bar", estimated ? "estimated" : "", continuesFrom ? "from-previous" : "", continuesTo ? "to-next" : ""].filter(Boolean).join(" ");
    const label = item.name + "，" + milestoneLevels[milestoneStyle(item).importance] + "，" + (estimated ? milestonePeriodLabel(item) :
      item.date + (endDate !== item.date ? " 至 " + endDate : ""));
    const showName = !continuesFrom || firstDay === viewStart;
    lane.bars.push(button(showName ? '<span>' + esc(item.name) + '</span>' : '<span aria-hidden="true">↳</span>',
      "calendarMilestone", { id: item.id, column: start + 1, span: end - start + 1 },
      'class="' + classes + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + milestoneAppearance(item)));
  }
  return lanes.map((lane) => '<div class="calendar-grid calendar-lane">' + lane.bars.join("") + '</div>').join("");
}

function journal() {
  const plan = current();
  const ordered = [...(plan.milestones ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const milestonesOn = (date) => ordered.filter((item) => item.date <= date && date <= (item.endDate || item.date));
  const selectedMilestones = milestonesOn(selected);
  const first = selected.slice(0, 7) + "-01";
  const weekday = (date) => (new Date(date).getUTCDay() + 6) % 7;
  const start = calendarMode === "month" ? shifted(first, -weekday(first)) : shifted(selected, -weekday(selected));
  const weeks = [];
  for (let i = 0; i < (calendarMode === "month" ? 6 : 1); i++) {
    const weekStart = shifted(start, i * 7);
    const days = [];
    for (let j = 0; j < 7; j++) {
      const date = shifted(weekStart, j);
      const total = plan.logs.filter((log) => log.date === date).reduce((sum, log) => sum + log.hours, 0);
      const items = milestonesOn(date);
      const classes = total || plan.dates[date] ? "marked" : "";
      const label = [date, ...items.map((item) => item.name), total ? hours(total) : "", plan.dates[date] ? "有计划" : ""]
        .filter(Boolean).join("，");
      days.push(button(String(Number(date.slice(-2))) +
        (total ? "<small>" + hours(total) + "</small>" : plan.dates[date] ? "<small>有计划</small>" : ""),
        "day", { date }, 'class="' + classes + '" aria-label="' + esc(label) + '" aria-pressed="' + (date === selected) + '"'));
    }
    weeks.push('<div class="calendar-week"><div class="calendar-grid calendar-dates">' + days.join("") +
      '</div>' + calendarBars(ordered, weekStart, start) + '</div>');
  }
  const logs = plan.logs.filter((log) => log.date === selected);
  return heading("学习记录", "在日历里安排学习，按学科或任务记录投入时间。", button("+ 添加学习时间", "log", {}, 'class="primary"')) +
    timeline(ordered) +
    panel('<div class="row wrap"><h3>' + selected.slice(0, 7) + '</h3><div class="actions">' + button("上一" + (calendarMode === "month" ? "月" : "周"), "calendar", { move: -1 }) +
    button("今天", "day", { date: today() }) + button("下一" + (calendarMode === "month" ? "月" : "周"), "calendar", { move: 1 }) +
    button(calendarMode === "month" ? "周视图" : "月视图", "calendarMode") + '</div></div><div class="calendar">' +
    '<div class="calendar-grid calendar-weekdays">' + ["一","二","三","四","五","六","日"].map((x) => "<small>" + x + "</small>").join("") +
    '</div>' + weeks.join("") + "</div>" +
    (selectedMilestones.length ? '<section class="calendar-milestones" aria-labelledby="calendar-milestones-title">' +
      '<h3 id="calendar-milestones-title">' + esc(selected) + ' · 备考事项</h3>' +
      '<ul>' + selectedMilestones.map((item) => '<li' + milestoneAppearance(item) + '>' + milestoneInfo(item) + '</li>').join("") + '</ul></section>' : "")) +
    panel("<h2>" + selected + "</h2>" + form("dateNote", '<input type="hidden" name="date" value="' + selected + '">' + area("当天计划", "text", plan.dates[selected])) +
    '<div class="section"><h3>当天投入</h3>' + (logs.length ? logs.map((log) => '<div class="row wrap task"><div><strong>' +
    esc(moduleName(log.moduleId)) + " · " + hours(log.hours) + '</strong><div class="multiline">' + esc(log.text) + "</div></div><div class=\"actions\">" +
    button("编辑", "log", { id: log.id }) + button("删除", "removeLog", { id: log.id }) + "</div></div>").join("") : empty("这天还没有学习记录。")) + '</div>') +
    panel("<h3>各学科累计投入</h3>" + plan.modules.map((item) => '<div class="row"><span>' + esc(item.name) + "</span><span>" +
      hours(plan.logs.filter((log) => log.moduleId === item.id).reduce((sum, log) => sum + log.hours, 0)) + "</span></div>").join(""));
}

function resourceFilter(label) {
  return '<label>' + label + '<input type="search" data-resource-filter placeholder="按名称、文件夹或存放位置搜索"></label>';
}

function resourceRow(note, content, folderPath) {
  const search = [note.title, note.source, folderPath].filter(Boolean).join(" ");
  return '<div data-resource-search="' + esc(search) + '">' + content + "</div>";
}

function folderOptions(index, excluding) {
  const options = [["", "资源库根目录"]];
  function visit(parent, ancestors) {
    for (const folder of index.children.get(parent) ?? []) {
      if (folder.id === excluding || folder.archived) continue;
      const path = [...ancestors, folder.name];
      options.push([folder.id, path.join(" / ")]);
      visit(folder.id, path);
    }
  }
  visit(null, []);
  return options;
}

function notes() {
  const plan = current();
  const allResources = libraryResources(plan);
  const index = resourceFolderIndex(plan);
  const ungrouped = allResources.filter((note) => !index.isArchived(note.folderId));
  const resources = ungrouped.filter((note) => !note.archived);
  const archived = ungrouped.filter((note) => note.archived);
  const archivedFolders = [...index.byId.values()].filter((folder) => folder.archived && !index.isArchived(folder.parentId));
  const archiveCount = archived.length + archivedFolders.length;
  const occupiedFolders = new Set(allResources.map((note) => note.folderId));
  const errors = plan.notes.filter((note) => note.kind === "error");
  const entries = new Map();
  for (const note of allResources) {
    const folder = index.byId.has(note.folderId) ? note.folderId : null;
    if (!entries.has(folder)) entries.set(folder, []);
    entries.get(folder).push(note);
  }
  const folderPath = (note) => index.path(note.folderId).map((folder) => folder.name).join(" / ");
  function resource(note, showPath = false, inArchivedFolder = false) {
    const path = folderPath(note);
    const count = plan.tasks.filter((task) => task.resourceIds?.includes(note.id)).length;
    const draggable = !note.archived && !inArchivedFolder;
    return resourceRow(note, '<div class="row resource-entry"' + (draggable ? attrs({ "library-id": note.id, "library-kind": "resource" }) : "") +
      ">" + (draggable ? libraryHandle(note.title) : "") + '<div class="resource-label"><strong>' +
      (webLink(note.source) ? showLocation(note.source, note.title) : esc(note.title)) +
      '</strong>' + (showPath ? '<small class="resource-location">' + esc(path || "根目录") + '</small>' : "") +
      (note.source && !webLink(note.source) ? '<small class="resource-location">' + esc(note.source) + "</small>" : "") +
      (note.text ? '<small class="resource-location multiline">' + esc(note.text) + "</small>" : "") +
      '</div>' + (inArchivedFolder ? "" : '<div class="actions">' + button("编辑", "note", { id: note.id }) +
      (note.archived ? button("恢复", "archiveResource", { id: note.id, archived: "" }) :
        count ? "<small>" + count + " 项引用</small>" : button("删除", "removeNote", { id: note.id })) + "</div>") + "</div>", path);
  }
  function folderBranch(folder, inArchive, archiveRoot = false) {
    const origin = archiveRoot ? index.path(folder.parentId).map((item) => item.name).join(" / ") : "";
    const sort = inArchive ? "" : attrs({ "library-id": folder.id, "library-kind": "folder", "library-drop": "move" });
    return '<details class="resource-folder" data-folder="' + esc(folder.id) + '"' + (openFolders.has(folder.id) ? " open" : "") +
      '><summary' + sort + '>' + (inArchive ? "" : libraryHandle(folder.name)) + '<span>' + esc(folder.name) + '</span>' +
      (archiveRoot ? ' <span class="actions archive-folder-actions">' + button("恢复文件夹", "archiveResource", { id: folder.id, archived: "" }) + '</span>' : "") +
      '</summary><div class="resource-branch">' + (inArchive ? (origin ? '<small class="resource-location">原位置 ' + esc(origin) + '</small>' : "") :
      '<div class="actions">' +
      button("+ 资源", "note", { kind: "resource", folder: folder.id }) +
      button("+ 子文件夹", "resourceFolder", { parent: folder.id }) +
      button("编辑文件夹", "resourceFolder", { id: folder.id }) +
      (index.children.has(folder.id) || occupiedFolders.has(folder.id) ||
        plan.tasks.some((task) => task.resourceIds?.includes(folder.id)) || folder.resource?.taskId
        ? "" : button("删除空文件夹", "removeResourceFolder", { id: folder.id })) +
      "</div>") + tree(folder.id, inArchive) + "</div></details>";
  }
  function tree(parent, inArchive = false) {
    const folders = (index.children.get(parent) ?? []).filter((folder) => inArchive || !folder.archived);
    const notes = (entries.get(parent) ?? []).filter((note) => inArchive || !note.archived);
    return folders.map((folder) => folderBranch(folder, inArchive)).join("") +
      notes.map((note) => resource(note, false, inArchive)).join("");
  }
  const card = (note) => panel('<div class="row wrap"><h3>' + esc(note.title) + '</h3><div class="actions">' +
      button("编辑", "note", { id: note.id }) +
      button("删除", "removeNote", { id: note.id }) +
      '</div></div><small>' + esc(moduleName(note.moduleId) || "未分类") +
      " · " + (note.reviewed ? "已复习" : "待复习") +
      '</small><p class="multiline">' + (note.source ? showLocation(note.source) : "") +
      '</p><p class="multiline">' + esc(note.text) + "</p>");
  return heading("资源库与错题", "盘点手头的教材、课程和经验贴，在任务里随时引用。") +
    '<section data-resource-scope><div class="row wrap"><h2>资源库</h2><div class="actions">' +
    button("+ 新增资源", "note", { kind: "resource" }, 'class="primary"') + button("+ 新建文件夹", "resourceFolder") +
    button('<span aria-hidden="true">🗃︎</span> 归档桶（' + archiveCount + '）', "libraryArchive", { "library-drop": "archive" },
      'aria-controls="resource-archive" aria-expanded="' + libraryArchiveOpen + '" title="可将资源或文件夹拖入归档桶"') + "</div></div>" +
    (resources.length ? resourceFilter("搜索资源库") : "") +
    '<div class="resource-tree" data-resource-tree><p class="quiet"><small>抓住左侧手柄，拖到文件夹、整理区或归档桶。</small></p>' +
    '<div class="library-dock"><span data-library-drop="move">移到根目录</span><span data-library-drop="folder">转为文件夹</span>' +
    '<span data-library-drop="resource">转为资源</span></div>' +
    (tree(null) || empty("新建文件夹或登记一份资源，即可开始整理。")) +
    '</div><div class="resource-tree" data-resource-results hidden>' + resources.map((note) => resource(note, true)).join("") +
    '<p class="empty" data-no-resources hidden>没有匹配的资源。</p></div>' +
    '<section id="resource-archive" class="resource-tree" aria-labelledby="resource-archive-title"' + (libraryArchiveOpen ? "" : " hidden") +
    '><h3 id="resource-archive-title">归档资源</h3>' +
    (archiveCount ? archivedFolders.map((folder) => folderBranch(folder, true, true)).join("") +
      archived.map((note) => resource(note, true)).join("") : empty("归档桶为空。")) + "</section>" +
    '</section><section class="section"><div class="row wrap"><h2>错题</h2>' +
    button("+ 错题", "note", { kind: "error" }) + "</div>" +
    (errors.length ? errors.map(card).join("") : empty("还没有错题。")) + "</section>";
}

function libraryHandle(name) {
  return '<button class="sort-handle" type="button" title="拖动整理目录" aria-label="' + esc("拖动 " + name) + '"' +
    attrs({ "sort-label": name }) + '><span aria-hidden="true">⠿</span></button>';
}

function referenceFields(task) {
  const index = resourceFolderIndex(current());
  const selected = new Set(task.resourceIds ?? []);
  const resources = referenceResources(current()).filter((note) =>
    (!note.isFolder && !note.archived && !index.isArchived(note.folderId)) || selected.has(note.id));
  return '<fieldset class="reference-fields" data-resource-scope><legend>参考资料</legend>' +
    (resources.length ? resourceFilter("从资源库选择（可多选）") + '<div class="checks resource-options">' +
      resources.map((note) => {
        const path = index.path(note.folderId).map((folder) => folder.name).join(" / ");
        return resourceRow(note, '<label><input type="checkbox" name="resourceIds" value="' +
        esc(note.id) + '"' + (selected.has(note.id) ? " checked" : "") + '><span>' + esc(note.title) +
        (note.isFolder ? "（已转为文件夹）" : note.archived || index.isArchived(note.folderId) ? "（已归档）" : "") +
        (path ? '<small class="resource-location">' + esc(path) + "</small>" : "") +
        (note.source ? '<small class="resource-location">' + esc(note.source) + "</small>" : "") + "</span></label>", path);
      }).join("") +
      '</div><p class="empty" data-no-resources hidden>没有匹配的资源，已勾选的资料会保留。</p>' :
      '<p class="quiet">可先到「资源库与错题」登记常用资料。</p>') +
    input("手动补充资料或链接", "resource", task.resource) + "</fieldset>";
}

function settings() {
  const plan = current(), s = plan.settings;
  return heading("备考设置", "确定院校和考试范围后，可以把已有学科或专题关联到两门专业课。",
    '<div class="actions">' + button("导出备份", "export") + button("导入备份", "importBackup") + "</div>") +
    panel("<h2>考试信息</h2>" + form("settings", '<div class="fields">' +
      input("目标院校", "school", s.school) + input("报考方向", "direction", s.direction) +
      input("考试年份", "year", s.year, 'inputmode="numeric" pattern="[0-9]{4}"') +
      input("总截止日期", "deadline", s.deadline, 'type="date"') + "</div>")) +
    panel("<h2>定校后的专业课</h2>" + s.courses.map((course, slot) => {
      const label = slot === 0 ? "专业课一" : "专业课二";
      const configured = course.name || course.code || course.scope || course.books || course.moduleIds?.length || course.taskIds?.length;
      return '<div class="row task"><div><strong>' + label + '</strong><div><small>' +
        (configured ? esc([course.name, course.code].filter(Boolean).join(" · ") || "已配置考试范围") + " · " + courseTasks(plan, course).length + " 项关联任务" : "待配置") +
        '</small></div></div><div class="actions">' + (configured ? '<a class="button" href="#course/' + slot + '">查看关联</a>' : "") +
        button("配置", "course", { slot }) + "</div></div>";
    }).join("")) + panel("<h2>学科管理</h2>" + plan.modules.map((item) => '<div class="row task"><span>' + esc(item.name) +
      (item.archived ? "（已归档）" : "") + "</span>" + button("编辑", "module", { id: item.id }) + "</div>").join("") +
      '<div class="section">' + button("+ 学科", "module") + "</div>");
}

function coursePage(slot) {
  const plan = current(), course = plan.settings.courses[slot];
  if (!course) return settings();
  const index = taskIndex(plan.tasks);
  const rows = courseTasks(plan, course);
  return heading(course.name || (slot === "0" ? "专业课一" : "专业课二"), course.code || "按考试范围查看已关联的学习任务。", button("配置", "course", { slot })) +
    (course.scope || course.books ? panel('<p class="multiline">' + esc(course.scope) + '</p><p class="multiline">' + esc(course.books) + "</p>") : "") +
    (rows.length ? panel(rows.map((task) => taskLine(task)).join("")) : empty("配置后将在这里显示关联任务。"));
}

function render() {
  if (!saved) return;
  endSort();
  const [page, arg] = (location.hash.slice(1) || "home").split("/");
  document.querySelectorAll("nav a").forEach((link) => {
    if (link.hash === "#" + (page === "course" ? "settings" : page)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (renderedRoute !== location.hash && page === "tree" && arg && arg !== "literature") expanded.add(arg);
  renderedRoute = location.hash;
  main.innerHTML = ({ home, tree, pool, journal, notes, settings, course: coursePage }[page] ?? home)(arg);
  main.querySelectorAll("details[data-folder]").forEach((item) => {
    item.addEventListener("toggle", () => {
      if (item.open) openFolders.add(item.dataset.folder);
      else openFolders.delete(item.dataset.folder);
      try { localStorage.setItem(folderViewKey, JSON.stringify([...openFolders])); } catch {}
    });
  });
  main.querySelectorAll("details[data-expand]").forEach((item) => {
    item.addEventListener("toggle", () => {
      if (item.open) expanded.add(item.dataset.expand);
      else expanded.delete(item.dataset.expand);
    });
  });
}

function open(label, content) {
  dialog.innerHTML = '<div class="row"><h2>' + esc(label) + '</h2>' + button("关闭", "close") + "</div>" + content;
  if (!dialog.open) dialog.showModal();
}

async function previewBackup(input) {
  const form = input.form;
  const submit = form.querySelector("button.primary");
  const preview = form.querySelector("[data-backup-preview]");
  const file = input.files[0];
  submit.disabled = true;
  preview.textContent = "";
  form.backup = null;
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("请选择小于 2 MB 的备份。");
    const backup = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (input.files[0] !== file) return;
    const counts = mergeBackup(structuredClone(current()), backup);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    preview.textContent = total ? "将新增 " + counts.tasks + " 个任务或小板块、" + counts.logs + " 条学习记录、" +
      counts.modules + " 个学科、" + counts.folders + " 个文件夹、" + counts.notes + " 条资料或错题、" +
      counts.dates + " 条日历计划、" + counts.milestones + " 个时间轴节点。" : "这份备份没有可新增的内容。";
    if (total) {
      form.backup = backup;
      submit.disabled = false;
    }
  } catch (error) {
    if (input.files[0] === file) preview.textContent = error instanceof SyntaxError
      ? "文件不是可读取的 JSON 备份。" : error.message;
  }
}

function edit(cmd, data) {
  const plan = current();
  const id = data.id;
  if (cmd === "moveTaskModule" || cmd === "deleteModule") {
    const deleting = cmd === "deleteModule";
    const item = (deleting ? plan.modules : plan.tasks).find((entry) => entry.id === id);
    if (!item) return;
    const sourceId = deleting ? item.id : item.moduleId;
    const destinations = plan.modules.filter((entry) => entry.id !== sourceId && !entry.archived)
      .map((entry) => [entry.id, groups[entry.group] + " / " + entry.name]);
    const options = deleting ? [...destinations, ["", "一并删除板块内的任务和学习时间记录"]] : destinations;
    open((deleting ? "删除板块 · " : "移动任务 · ") + item.name,
      (deleting ? "<p>选择内容转移目标，或一并删除。删除板块前将再次确认。</p>" : "<p>子任务和关联记录会随任务一起移动，任务放到目标板块根目录。</p>") +
      form(deleting ? "removeModule" : "moveTaskModule",
        '<input type="hidden" name="' + (deleting ? "moduleId" : "id") + '" value="' + esc(id) + '">' +
        select(deleting ? "内容处理" : "目标板块", "destination", options, options[0]?.[0] ?? "")));
    return;
  }
  if (cmd === "milestone") {
    const item = (plan.milestones ?? []).find((entry) => entry.id === id);
    const estimated = item?.precision === "period";
    const { importance, color } = milestoneStyle(item ?? {});
    open(item ? "编辑时间轴节点" : "添加时间轴节点", form("milestone",
      input("事项", "name", item?.name, 'required maxlength="120" placeholder="例如：考研报名"') +
      '<div class="fields">' + select("重要程度", "importance", Object.entries(milestoneLevels), importance) +
      select("颜色", "color", Object.entries(milestoneColors), color) + "</div>" +
      select("日期精度", "precision", [["exact", "具体日期"], ["period", "按旬估计"]], estimated ? "period" : "exact") +
      '<fieldset class="milestone-fields fields" data-date-fields="exact"' + (estimated ? " hidden disabled" : "") + '>' +
      input("日期或开始日期", "date", estimated ? "" : item?.date, 'type="date" required') +
      input("结束日期（可选）", "endDate", estimated ? "" : item?.endDate, 'type="date"') + '</fieldset>' +
      '<fieldset class="milestone-fields fields" data-date-fields="period"' + (estimated ? "" : " hidden disabled") + '>' +
      input("月份", "month", item?.month ?? item?.date.slice(0, 7) ?? today().slice(0, 7),
        'type="month" required placeholder="YYYY-MM" pattern="[0-9]{4}-(0[1-9]|1[0-2])"') +
      select("旬", "period", Object.entries(monthPeriods), item?.period ?? "early") + '</fieldset>' +
      input("相关网址（可选）", "link", item?.link, 'type="url" maxlength="2048" placeholder="https://"') +
      area("备注（可选）", "note", item?.note, 'maxlength="3000"'), id));
    return;
  }
  if (cmd === "resourceFolder") {
    const index = resourceFolderIndex(plan);
    const folder = index.byId.get(id);
    open(folder ? "编辑文件夹" : "新建文件夹", form("resourceFolder",
      input("文件夹名称", "name", folder?.name, "required") +
      select("上级文件夹", "parentId", folderOptions(index, id), folder?.parentId ?? data.parent ?? ""), id) +
      (folder ? '<div class="section">' + button("转为资源", "organizeResource", { id, operation: "resource" }) + "</div>" : ""));
  }
  if (cmd === "task") {
    const task = id ? plan.tasks.find((item) => item.id === id) : {};
    const moduleId = task.moduleId ?? data.module;
    const section = id ? isSection(task) : data.kind === "section";
    const type = section ? "小板块" : "任务";
    open((id ? "编辑" : "新建") + type, form("task", '<div class="quiet">' + esc(moduleName(moduleId)) + '</div>' +
      '<input type="hidden" name="kind" value="' + (section ? "section" : "task") + '">' +
      '<input type="hidden" name="moduleId" value="' + esc(moduleId) + '"><input type="hidden" name="parentId" value="' + esc(data.parent) + '">' +
      input(type + "名称", "name", task.name, "required") + (section ? "" : '<div class="fields">' +
      select("状态", "status", Object.entries(statuses), task.status || "TODO") +
      select("优先级", "priority", [1,2,3,4,5].map((p) => [p,"P" + p]), task.priority ?? 1) +
      input("预计小时", "hours", task.hours ?? 0, 'type="number" min="0" max="10000" step="0.01" required') +
      input("截止日期", "deadline", task.deadline, 'type="date"') + '</div>') +
      referenceFields(task) + area(section ? "板块说明" : "说明与完成标准", "notes", task.notes), id) +
      (id ? '<div class="section actions">' + (section ? button("转为根任务", "makeTask", { id }) :
        button("转为小板块", "makeSection", { id, "module-id": moduleId })) +
        button("移动到其他板块", "moveTaskModule", { id }) +
        button("删除" + type, "removeTask", { id }) + "</div>" : ""));
    if (data.parent) expanded.add(data.parent);
    pinnedModule = moduleId;
  }
  if (cmd === "moduleNote") {
    const item = plan.modules.find((row) => row.id === id);
    if (!item) return;
    open(item.name + " · 板块备注", form("moduleNote",
      '<input type="hidden" name="moduleId" value="' + esc(item.id) + '">' +
      area("备注", "note", item.note, 'maxlength="3000"')));
    return;
  }
  if (cmd === "module") {
    const item = plan.modules.find((row) => row.id === id) ?? {};
    const canEdit = !id || item.group === "literature";
    open(id ? "编辑板块" : "新增专业基础学科", form("module",
      '<input type="hidden" name="moduleId" value="' + esc(id) + '">' +
      (canEdit ? input("学科名称", "name", item.name, "required") : "<p>" + esc(item.name) + "</p>") +
      input("板块截止日期", "deadline", item.deadline, 'type="date"') +
      (canEdit && id ? select("可见状态", "archived", [["","使用中"],["yes","已归档"]], item.archived ? "yes" : "") : "")) +
      (id ? '<div class="section actions">' + button("删除板块", "deleteModule", { id }) + '</div>' : ""));
  }
  if (cmd === "course") {
    const slot = Number(data.slot);
    const item = plan.settings.courses[slot];
    const descendants = plan.modules.filter((m) => m.group === "literature");
    const check = (name, value, label, checked) => '<label><input type="checkbox" name="' + name + '" value="' + esc(value) + '"' +
      (checked ? " checked" : "") + '><span>' + esc(label) + "</span></label>";
    open(slot === 0 ? "配置专业课一" : "配置专业课二", form("course",
      '<input type="hidden" name="slot" value="' + slot + '">' + '<div class="fields">' +
      input("科目名称", "name", item.name) + input("科目代码", "code", item.code) + "</div>" +
      area("考试范围", "scope", item.scope) + area("参考书", "books", item.books) +
      '<div class="checks"><strong>关联整门学科</strong>' + descendants.map((m) =>
      check("moduleIds", m.id, m.name, item.moduleIds?.includes(m.id))).join("") +
      '</div><div class="checks"><strong>关联具体任务分支</strong>' + descendants.map((m) => taskOptions(m.id, { includeSections: true }).map(([key, label]) =>
      check("taskIds", key, m.name + " · " + label, item.taskIds?.includes(key))).join("")).join("") + "</div>"));
  }
  if (cmd === "log" || cmd === "note") {
    const isLog = cmd === "log";
    const item = (isLog ? plan.logs : plan.notes).find((row) => row.id === id) ?? {};
    const kind = item.kind ?? data.kind ?? "resource";
    const isResource = !isLog && kind === "resource";
    const moduleId = item.moduleId ?? (isResource ? "" : allModules()[0]?.[0]);
    open(isLog ? "记录学习时间" : kind === "error" ? "错题记录" : "资源登记", form(cmd,
      (isResource
        ? select("存放文件夹", "folderId", folderOptions(resourceFolderIndex(plan)), item.folderId ?? data.folder ?? "") +
          select("资源状态", "archived", [["", "在资源库"], ["yes", "放入归档桶"]], item.archived ? "yes" : "")
        : select("学科", "moduleId", allModules(), moduleId) +
          select("对应任务（可选）", "taskId", [["","直接关联学科"], ...taskOptions(moduleId, { currentId: item.taskId })], item.taskId ?? "")) +
      (isLog ? '<div class="fields">' + input("日期", "date", item.date ?? selected, 'type="date" required') +
        input("时长（小时）", "hours", item.hours, 'type="number" min="0.01" max="24" step="0.01" required') + "</div>" + area("学习笔记", "text", item.text)
        : '<input type="hidden" name="kind" value="' + kind + '">' + input(kind === "error" ? "题目或题型" : "资料名称", "title", item.title, "required") +
        input(kind === "error" ? "题目来源" : "链接或存放位置", "source", item.source, isResource ? 'placeholder="例如网盘链接、电脑文件夹、书架第二层"' : "") +
        area(kind === "error" ? "失分原因与答案要点" : "用途与笔记", "text", item.text) +
        (kind === "error" ? select("复习状态", "reviewed", [["","待复习"],["yes","已复习"]], item.reviewed ? "yes" : "") : "")), id) +
      (isResource && id && !item.archived ? '<div class="section">' + button("转为文件夹", "organizeResource", { id, operation: "folder" }) + "</div>" : ""));
  }
}

document.addEventListener("input", (event) => {
  const input = event.target;
  if (!input.matches("[data-resource-filter]")) return;
  const scope = input.closest("[data-resource-scope]");
  const term = input.value.trim().toLocaleLowerCase();
  const tree = scope.querySelector("[data-resource-tree]");
  const results = scope.querySelector("[data-resource-results]") ?? scope;
  if (tree) {
    tree.hidden = Boolean(term);
    results.hidden = !term;
  }
  let visible = 0;
  for (const row of results.querySelectorAll("[data-resource-search]")) {
    row.hidden = !row.dataset.resourceSearch.toLocaleLowerCase().includes(term);
    if (!row.hidden) visible++;
  }
  results.querySelector("[data-no-resources]").hidden = visible > 0;
});

document.addEventListener("change", (event) => {
  const element = event.target;
  if (element.matches('.timeline-filter select[name="timelineColor"]')) {
    timelineColor = element.value;
    render();
    main.querySelector('.timeline-filter select')?.focus({ preventScroll: true });
    return;
  }
  if (element.matches("[data-backup-file]")) return void previewBackup(element);
  if (element.form?.dataset.action === "milestone" && element.name === "precision") {
    for (const fields of element.form.querySelectorAll("[data-date-fields]")) {
      fields.hidden = fields.disabled = fields.dataset.dateFields !== element.value;
    }
  }
  if (dialog.open && element.name === "moduleId" && element.form?.elements.taskId) {
    const taskSelect = element.form.elements.taskId;
    taskSelect.replaceChildren(new Option("直接关联学科", ""), ...taskOptions(element.value).map(([key, label]) => new Option(label, key)));
  }
});

document.addEventListener("submit", (event) => {
  const target = event.target;
  const action = target.dataset.action;
  if (!action) return;
  event.preventDefault();
  if (action === "importBackup") {
    if (target.backup) void save(action, { backup: target.backup }, target.querySelector(".form-error"));
    return;
  }
  const fields = new FormData(target);
  const data = Object.fromEntries(fields);
  if (action === "removeModule" && !confirm(data.destination
    ? "确认转移内容后删除此板块？" : "确认删除此板块及其全部任务、学习时间记录？")) return;
  if (action === "filter") { Object.assign(filters, data); render(); return; }
  if (target.dataset.id) data.id = target.dataset.id;
  if (action === "task") data.resourceIds = fields.getAll("resourceIds");
  if (action === "course") {
    data.slot = Number(data.slot);
    data.moduleIds = fields.getAll("moduleIds");
    data.taskIds = fields.getAll("taskIds");
  }
  save(action, data, target.querySelector(".form-error"));
});

document.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
  const target = event.target.closest("[data-cmd]");
  if (!target) return;
  const { cmd, ...data } = target.dataset;
  if (cmd === "toggleTimeline") {
    timelineOpen = !timelineOpen;
    document.getElementById("timeline-content").hidden = !timelineOpen;
    target.setAttribute("aria-expanded", String(timelineOpen));
    return;
  }
  if (cmd === "libraryArchive") {
    libraryArchiveOpen = !libraryArchiveOpen;
    const archive = document.getElementById("resource-archive");
    archive.hidden = !libraryArchiveOpen;
    target.setAttribute("aria-expanded", String(libraryArchiveOpen));
    if (libraryArchiveOpen) archive.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (cmd === "toggleNote") {
    const note = target.closest("[data-note-disclosure]").querySelector("[data-note-text]");
    note.hidden = !note.hidden;
    target.setAttribute("aria-expanded", String(!note.hidden));
    return;
  }
  if (["task","module","moduleNote","course","log","note","resourceFolder","milestone","deleteModule","moveTaskModule"].includes(cmd)) return edit(cmd, data);
  if (cmd === "close") return dialog.close();
  if (cmd === "importBackup") {
    open("导入备份", '<form data-action="importBackup"><p>选择从文学考研规划导出的 JSON。导入只新增记录，' +
      '现有任务、同日计划和备考设置均保留。</p><label>备份文件<input type="file" accept=".json,application/json" data-backup-file></label>' +
      '<p data-backup-preview role="status"></p><p class="form-error" role="alert" hidden></p>' +
      '<div><button class="primary" disabled>合并导入</button></div></form>');
    return;
  }
  if (cmd === "sectionExpand") {
    const branch = document.getElementById(target.getAttribute("aria-controls"));
    branch.hidden = !branch.hidden;
    const open = !branch.hidden;
    if (open) expanded.add(data.id);
    else {
      expanded.delete(data.id);
      if (pinnedModule === data.id) pinnedModule = "";
    }
    target.setAttribute("aria-expanded", String(open));
    target.firstElementChild.textContent = open ? "▾" : "▸";
    return;
  }
  if (cmd === "day") { selected = data.date; return render(); }
  if (cmd === "calendarMilestone") {
    const item = (current().milestones ?? []).find((entry) => entry.id === data.id);
    if (item) open("备考事项", milestoneInfo(item));
    return;
  }
  if (cmd === "calendarMode") { calendarMode = calendarMode === "month" ? "week" : "month"; return render(); }
  if (cmd === "calendar") {
    if (calendarMode === "week") selected = shifted(selected, Number(data.move) * 7);
    else {
      const date = new Date(selected.slice(0, 7) + "-01T12:00:00Z");
      date.setUTCMonth(date.getUTCMonth() + Number(data.move));
      selected = date.toISOString().slice(0, 10);
    }
    return render();
  }
  if (cmd === "export") {
    const file = new Blob([JSON.stringify(current(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "literature-plan-" + today() + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (cmd.startsWith("remove") && !confirm("确认删除这条记录？")) return;
  save(cmd, data);
});

function sameSortGroup(a, b) {
  return b && a !== b && b.dataset.sortAction === a.dataset.sortAction && b.dataset.sortGroup === a.dataset.sortGroup;
}

function persistSort(source, target, after) {
  if (source.dataset.libraryId) {
    if (target.dataset.libraryDrop === "archive") {
      return save("archiveResource", { id: source.dataset.libraryId, archived: "yes" });
    }
    const targetId = target.dataset.libraryId || "";
    if (targetId) {
      for (const folder of resourceFolderIndex(current()).path(targetId)) openFolders.add(folder.id);
      try { localStorage.setItem(folderViewKey, JSON.stringify([...openFolders])); } catch {}
    }
    return save("organizeResource", { id: source.dataset.libraryId, operation: target.dataset.libraryDrop, targetId });
  }
  const { sortId, sortAction } = source.dataset;
  if (source.dataset.taskModule && target.dataset.section) {
    expanded.add(target.dataset.taskModule);
    expanded.add(target.dataset.section);
    return save("moveTaskModule", {
      id: sortId, destination: target.dataset.taskModule, parentId: target.dataset.section,
    });
  }
  if (source.dataset.taskModule && target.dataset.sectionDrop) {
    const destination = target.dataset.sectionDrop;
    expanded.add(destination);
    return save("moveTaskModule", { id: sortId, destination });
  }
  const idField = sortAction === "moveModule" ? "moduleId" : "id";
  return save(sortAction, { [idField]: sortId, target: target.dataset.sortId, after });
}

function markSort(position) {
  drag.target?.removeAttribute("data-insert");
  drag.target = null;
  const hit = document.elementFromPoint(position.x, position.y);
  if (drag.source.dataset.libraryId) {
    const drop = hit?.closest("[data-library-drop]");
    if (!drop) return;
    const { libraryId, libraryKind } = drag.source.dataset;
    const { libraryDrop, libraryId: targetId } = drop.dataset;
    if (libraryDrop === libraryKind) return;
    if (targetId && resourceFolderIndex(current()).path(targetId).some((folder) => folder.id === libraryId)) return;
    drag.target = drop;
    drop.dataset.insert = "library";
    return;
  }
  const section = hit?.closest("[data-section]");
  if (section && drag.source.dataset.taskModule && !drag.source.dataset.section) {
    drag.target = section;
    section.dataset.insert = "nest";
    return;
  }
  const header = hit?.closest("[data-section-drop]");
  if (header && drag.source.dataset.taskModule) {
    drag.target = header;
    header.dataset.insert = "transfer";
    return;
  }
  const target = hit?.closest("[data-sort-id]");
  if (!sameSortGroup(drag.source, target)) return;
  const rect = target.getBoundingClientRect();
  drag.after = position.y >= rect.top + rect.height / 2;
  drag.target = target;
  target.dataset.insert = drag.after ? "after" : "before";
}

function scrollSort() {
  const { position } = drag;
  const edge = 52;
  const speed = position.y < edge ? -8 : position.y > window.innerHeight - edge ? 8 : 0;
  if (speed) {
    window.scrollBy(0, speed);
    markSort(position);
  }
  drag.frame = requestAnimationFrame(scrollSort);
}

function endSort() {
  if (!drag) return;
  const { source, target, ghost, handle, pointerId, frame } = drag;
  drag = null;
  cancelAnimationFrame(frame);
  target?.removeAttribute("data-insert");
  source.classList.remove("sorting-source");
  ghost?.remove();
  if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
}

main.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".sort-handle");
  if (!handle || drag || busy || !event.isPrimary || event.button !== 0) return;
  drag = { handle, source: handle.closest("[data-sort-id], [data-library-id]"), pointerId: event.pointerId,
    x: event.clientX, y: event.clientY };
  handle.setPointerCapture(event.pointerId);
});
main.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { clientX: x, clientY: y } = event;
  if (!drag.ghost) {
    if (Math.hypot(x - drag.x, y - drag.y) < 5) return;
    drag.ghost = document.createElement("div");
    drag.ghost.className = "sort-ghost";
    drag.ghost.textContent = drag.handle.dataset.sortLabel;
    drag.ghost.setAttribute("aria-hidden", "true");
    document.body.append(drag.ghost);
    drag.source.classList.add("sorting-source");
    drag.frame = requestAnimationFrame(scrollSort);
  }
  drag.position = { x, y };
  drag.ghost.style.transform = "translate(" + (x + 12) + "px," + (y + 10) + "px)";
  markSort(drag.position);
});
main.addEventListener("pointerup", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.ghost) markSort({ x: event.clientX, y: event.clientY });
  const { source, target, after } = drag;
  endSort();
  if (target) void persistSort(source, target, after);
});
for (const type of ["pointercancel", "lostpointercapture"]) {
  main.addEventListener(type, (event) => {
    if (drag?.pointerId === event.pointerId) endSort();
  });
}
main.addEventListener("click", (event) => {
  if (event.target.closest(".sort-handle")) event.preventDefault();
});
main.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drag) endSort();
  const handle = event.target.closest(".sort-handle");
  if (!handle || busy || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const source = handle.closest("[data-sort-id]");
  if (!source) return;
  const peers = [...main.querySelectorAll("[data-sort-id]")].filter((row) =>
    (row === source || sameSortGroup(source, row)) && row.getClientRects().length);
  const after = event.key === "ArrowDown";
  const target = peers[peers.indexOf(source) + (after ? 1 : -1)];
  if (target) void persistSort(source, target, after).then(() =>
    main.querySelector('[data-sort-id="' + CSS.escape(source.dataset.sortId) + '"] .sort-handle')?.focus());
});
window.addEventListener("hashchange", () => { pinnedModule = ""; render(); window.scrollTo(0, 0); });
load().catch((error) => { main.innerHTML = heading("文学考研备考规划", error.message) + '<a class="button" href="./">重新加载</a>'; });
