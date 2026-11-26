export const statuses = { TODO: "待办", DOING: "进行中", REVIEW: "复习中", DONE: "已完成" };
export const groups = { politics: "政治", english: "英语", literature: "汉语言文学基础" };
export const localDay = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(date);

export function initialPlan() {
  return {
    version: 1,
    settings: { school: "", direction: "", year: "", deadline: "", courses: [{}, {}] },
    modules: [
      { id: "politics", group: "politics", name: "政治" },
      { id: "english", group: "english", name: "英语" },
      ...["古代汉语", "现代汉语", "中国现当代文学", "中国古代文学", "语言学纲要", "外国文学"]
        .map((name, index) => ({ id: "subject-" + index, group: "literature", name })),
    ],
    tasks: [], logs: [], notes: [], resourceFolders: [], dates: {}, milestones: [],
  };
}

// The French planner stores parent IDs and derives the visible tree and breadcrumbs.
export const isSection = (task) => task?.kind === "section";

export function taskIndex(tasks) {
  const byId = new Map();
  const children = new Map();
  for (const task of tasks) {
    byId.set(task.id, task);
    const key = task.parentId ?? task.moduleId;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(task);
  }
  const siblings = (id) => children.get(id) ?? [];
  const path = (id) => {
    const result = [];
    while (byId.has(id)) {
      const task = byId.get(id);
      result.unshift(task);
      id = task.parentId;
    }
    return result;
  };
  return { byId, siblings, path, leaves: tasks.filter((task) => !isSection(task) && !children.has(task.id)) };
}

export function stats(tasks, logs) {
  const { leaves } = taskIndex(tasks);
  const estimated = leaves.reduce((total, task) => total + task.hours, 0);
  const completed = leaves.reduce((total, task) => total + (task.status === "DONE" ? task.hours : 0), 0);
  return {
    estimated,
    logged: logs.reduce((total, log) => total + log.hours, 0),
    remaining: leaves.filter((task) => task.status !== "DONE").length,
    percent: estimated ? Math.round(completed / estimated * 100) : 0,
  };
}

export function courseTasks(plan, course) {
  const moduleIds = new Set(course.moduleIds ?? []);
  const taskIds = new Set(course.taskIds ?? []);
  const index = taskIndex(plan.tasks);
  return plan.tasks.filter((task) =>
    moduleIds.has(task.moduleId) || index.path(task.id).some((node) => taskIds.has(node.id)));
}

export const libraryResources = (plan) => plan.notes.filter((note) => note.kind === "resource");

export function referenceResources(plan) {
  return [...libraryResources(plan), ...(plan.resourceFolders ?? []).filter((folder) => folder.resource)
    .map((folder) => ({ ...folder.resource, title: folder.name, folderId: folder.parentId, isFolder: true }))];
}

export function resourceFolderIndex(plan) {
  const byId = new Map((plan.resourceFolders ?? []).map((folder) => [folder.id, folder]));
  const children = new Map();
  for (const folder of byId.values()) {
    const parent = folder.parentId ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(folder);
  }
  const path = (id) => {
    const result = [];
    while (byId.has(id)) {
      const folder = byId.get(id);
      result.unshift(folder);
      id = folder.parentId;
    }
    return result;
  };
  const isArchived = (id) => path(id).some((folder) => folder.archived === true);
  return { byId, children, path, isArchived };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const clean = (value, limit = 3000) => String(value ?? "").trim().slice(0, limit);
const named = (value) => {
  const result = clean(value, 120);
  assert(result, "请填写名称。");
  return result;
};
const number = (value, min, max) => {
  const parsed = Number(value);
  assert(Number.isFinite(parsed) && parsed >= min && parsed <= max, "请填写有效数字。");
  return parsed;
};
const day = (value, required = false) => {
  const result = clean(value, 20);
  if (result || required) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(result) &&
      new Date(result + "T00:00:00Z").toJSON()?.slice(0, 10) === result, "请选择有效日期。");
  }
  return result;
};
const remove = (rows, id) => rows.filter((row) => row.id !== id);
const put = (rows, row) => rows.some((item) => item.id === row.id)
  ? rows.map((item) => item.id === row.id ? row : item) : [...rows, row];

export const monthPeriods = { early: "上旬", middle: "中旬", late: "下旬" };
export const milestoneLevels = { normal: "普通节点", important: "重要节点" };
export const milestoneColors = { auto: "自动（按重要程度）", red: "砖红", amber: "琥珀", green: "松绿", blue: "靛蓝", purple: "紫色" };

export function milestoneStyle(item) {
  const importance = Object.hasOwn(milestoneLevels, item.importance) ? item.importance : "normal";
  const color = Object.hasOwn(milestoneColors, item.color) ? item.color : "auto";
  return { importance, color };
}

function readMilestone(data) {
  const link = clean(data.link, 2048);
  if (link) {
    let url;
    try { url = new URL(link); } catch {}
    assert(url && /^https?:\/\//i.test(link) && ["http:", "https:"].includes(url.protocol) &&
      !url.username && !url.password, "请填写以 https:// 或 http:// 开头的网址。");
  }
  const name = named(data.name);
  const fields = { name, link, note: clean(data.note), ...milestoneStyle(data) };
  const precision = data.precision ?? "exact";
  assert(precision === "exact" || precision === "period", "请选择日期精度。");
  if (precision === "period") {
    const { month, period } = data;
    assert(typeof month === "string" && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month), "请选择有效月份。");
    assert(typeof period === "string" && Object.hasOwn(monthPeriods, period), "请选择上旬、中旬或下旬。");
    const from = month + "-01";
    const last = new Date(from + "T00:00:00Z");
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    const startDay = { early: "01", middle: "11", late: "21" }[period];
    const endDay = { early: "10", middle: "20", late: String(last.getUTCDate()) }[period];
    return { ...fields, precision, month, period, date: month + "-" + startDay, endDate: month + "-" + endDay };
  }
  const date = day(data.date, true);
  const endDate = day(data.endDate);
  assert(!endDate || endDate >= date, "结束日期应在开始日期当天或之后。");
  return { ...fields, date, endDate };
}

export function mergeBackup(plan, backup) {
  const invalid = "备份格式无效，请选择从文学考研规划导出的 JSON。";
  assert(backup?.version === 1, invalid);
  const readId = (id, optional = false) => {
    if (optional && (id === null || id === undefined || id === "")) return null;
    assert(typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id), invalid);
    return id;
  };
  const read = (items, normalize) => {
    assert(Array.isArray(items) && items.length <= 10000, invalid);
    const ids = new Set();
    return items.map((item) => {
      assert(item && typeof item === "object", invalid);
      const id = readId(item.id);
      assert(!ids.has(id), invalid);
      ids.add(id);
      return { id, ...normalize(item) };
    });
  };
  const optionalId = (id) => readId(id, true);
  const readNote = (item) => {
    assert(item.kind === "resource" || item.kind === "error", invalid);
    return { kind: item.kind, title: named(item.title), source: clean(item.source), text: clean(item.text),
      reviewed: item.reviewed === true, moduleId: optionalId(item.moduleId), taskId: optionalId(item.taskId),
      ...(item.kind === "resource" ? { folderId: optionalId(item.folderId), archived: item.archived === true } : {}) };
  };
  const modules = read(backup.modules, (item) => {
    assert(Object.hasOwn(groups, item.group), invalid);
    return { name: named(item.name), group: item.group, deadline: day(item.deadline), archived: item.archived === true,
      note: clean(item.note) };
  });
  const folders = read(backup.resourceFolders ?? [], (item) => ({
    name: named(item.name), parentId: optionalId(item.parentId), archived: item.archived === true,
    ...(item.resource ? { resource: { id: readId(item.id), ...readNote(item.resource), kind: "resource" } } : {}),
  }));
  const notes = read(backup.notes, readNote);
  const tasks = read(backup.tasks, (item) => {
    assert(Object.hasOwn(statuses, item.status) && (!item.kind || ["section", "task"].includes(item.kind)), invalid);
    assert(item.resourceIds === undefined || Array.isArray(item.resourceIds), invalid);
    return { name: named(item.name), moduleId: readId(item.moduleId), parentId: optionalId(item.parentId),
      kind: item.kind ?? "task", status: item.status, hours: number(item.hours, 0, 10000),
      priority: number(item.priority, 1, 5), deadline: day(item.deadline), notes: clean(item.notes),
      resource: clean(item.resource), resourceIds: [...new Set((item.resourceIds ?? []).map((id) => readId(id)))] };
  });
  const logs = read(backup.logs, (item) => ({
    moduleId: readId(item.moduleId), taskId: optionalId(item.taskId),
    date: day(item.date, true), hours: number(item.hours, 0.01, 24), text: clean(item.text),
  }));
  const rawDates = backup.dates ?? {};
  assert(typeof rawDates === "object" && !Array.isArray(rawDates), invalid);
  const dates = Object.entries(rawDates).map(([date, content]) => [day(date, true), clean(content)]);

  // IDs are stable across exports. An existing ID always belongs to the private plan.
  const missing = (current, incoming, reserved = []) => {
    const ids = new Set([...current, ...reserved].map((item) => item.id));
    return incoming.filter((item) => !ids.has(item.id));
  };
  const addModules = missing(plan.modules, modules);
  const addFolders = missing(plan.resourceFolders ?? [], folders, plan.notes);
  const addNotes = missing(plan.notes, notes, [...(plan.resourceFolders ?? []), ...addFolders]);
  const addTasks = missing(plan.tasks, tasks);
  const addLogs = missing(plan.logs, logs);
  const addDates = dates.filter(([date, content]) => content && !Object.hasOwn(plan.dates, date));
  const addMilestones = missing(plan.milestones ?? [], read(backup.milestones ?? [], readMilestone));
  const map = (items) => new Map(items.map((item) => [item.id, item]));
  const moduleMap = map([...plan.modules, ...addModules]);
  const folderMap = map([...(plan.resourceFolders ?? []), ...addFolders]);
  const taskMap = map([...plan.tasks, ...addTasks]);
  const resourceIds = new Set([...referenceResources(plan), ...addNotes.filter((item) => item.kind === "resource"),
    ...addFolders.filter((item) => item.resource)].map((item) => item.id));
  function validateParents(item, index) {
    const seen = new Set([item.id]);
    let parent = item.parentId;
    while (parent) {
      const node = index.get(parent);
      assert(node && !seen.has(parent) && seen.size <= 100 &&
        (!item.moduleId || item.moduleId === node.moduleId), "备份里的任务或文件夹层级无效。");
      seen.add(parent);
      parent = node.parentId;
    }
  }
  for (const item of addFolders) validateParents(item, folderMap);
  for (const item of addTasks) {
    assert(moduleMap.has(item.moduleId) && (!isSection(item) || !item.parentId) &&
      item.resourceIds.every((id) => resourceIds.has(id)), "备份缺少任务所属学科或引用资料。");
    validateParents(item, taskMap);
  }
  for (const item of [...addNotes, ...addFolders.filter((folder) => folder.resource).map((folder) => folder.resource)]) {
    assert((!item.moduleId || moduleMap.has(item.moduleId)) && (!item.taskId || taskMap.has(item.taskId)),
      "备份里的资料关联无效。");
  }
  for (const item of addNotes) {
    assert(!item.folderId || folderMap.has(item.folderId), "备份里的资料所属文件夹不存在。");
  }
  for (const item of addLogs) {
    assert(moduleMap.has(item.moduleId) && (!item.taskId || taskMap.get(item.taskId)?.moduleId === item.moduleId),
      "备份里的学时记录缺少对应学科或任务。");
  }

  plan.modules.push(...addModules);
  if (addFolders.length) plan.resourceFolders = [...(plan.resourceFolders ?? []), ...addFolders];
  plan.notes.push(...addNotes);
  plan.tasks.push(...addTasks);
  plan.logs.push(...addLogs);
  for (const [date, content] of addDates) plan.dates[date] = content;
  if (addMilestones.length) plan.milestones = [...(plan.milestones ?? []), ...addMilestones];
  return { tasks: addTasks.length, logs: addLogs.length, modules: addModules.length,
    folders: addFolders.length, notes: addNotes.length, dates: addDates.length, milestones: addMilestones.length };
}

function reorderRelative(rows, item, target, after) {
  const from = rows.indexOf(item);
  const targetIndex = rows.indexOf(target);
  rows.splice(from, 1);
  rows.splice(rows.indexOf(target) + ((after ?? (from < targetIndex)) ? 1 : 0), 0, item);
}

function transferTasks(plan, ids, destination) {
  for (const item of plan.tasks) if (ids.has(item.id)) item.moduleId = destination.id;
  for (const item of [...plan.logs, ...plan.notes, ...(plan.resourceFolders ?? []).map((folder) => folder.resource).filter(Boolean)])
    if (ids.has(item.taskId)) item.moduleId = destination.id;
  if (destination.group !== "literature") {
    for (const course of plan.settings.courses)
      if (course.taskIds) course.taskIds = course.taskIds.filter((id) => !ids.has(id));
  }
}

export function apply(plan, { action, data = {} }) {
  if (action === "importBackup") return mergeBackup(plan, data.backup);
  const module = plan.modules.find((item) => item.id === data.moduleId);
  const task = plan.tasks.find((item) => item.id === data.id);
  switch (action) {
    case "settings": {
      const year = clean(data.year, 8);
      assert(!year || /^\d{4}$/.test(year), "请填写四位考试年份。");
      Object.assign(plan.settings, { school: clean(data.school, 100), direction: clean(data.direction, 100), year, deadline: day(data.deadline) });
      break;
    }
    case "course": {
      assert(data.slot === 0 || data.slot === 1, "请选择专业课。");
      const literatureModules = new Set(plan.modules.filter((item) => item.group === "literature").map((item) => item.id));
      const taskIds = new Set(plan.tasks.filter((item) => literatureModules.has(item.moduleId)).map((item) => item.id));
      plan.settings.courses[data.slot] = {
        name: clean(data.name, 100), code: clean(data.code, 40),
        scope: clean(data.scope), books: clean(data.books),
        moduleIds: [...new Set((data.moduleIds ?? []).filter((id) => literatureModules.has(id)))],
        taskIds: [...new Set((data.taskIds ?? []).filter((id) => taskIds.has(id)))],
      };
      break;
    }
    case "module": {
      if (module) {
        module.deadline = day(data.deadline);
        if (module.group === "literature") {
          module.name = named(data.name);
          module.archived = Boolean(data.archived);
        }
      } else {
        assert(!data.moduleId, "学科不存在。");
        plan.modules.push({ id: crypto.randomUUID(), group: "literature", name: named(data.name), deadline: day(data.deadline) });
      }
      break;
    }
    case "moduleNote": {
      assert(module, "学科不存在。");
      module.note = clean(data.note);
      break;
    }
    case "removeModule": {
      assert(module, "板块不存在。");
      const destination = plan.modules.find((item) => item.id === data.destination);
      assert(!data.destination || (destination && destination !== module && !destination.archived), "请选择其他可用板块。");
      const ids = new Set(plan.tasks.filter((item) => item.moduleId === module.id).map((item) => item.id));
      const related = [...plan.notes, ...(plan.resourceFolders ?? []).map((folder) => folder.resource).filter(Boolean)];
      if (destination) {
        transferTasks(plan, ids, destination);
        for (const item of [...plan.logs, ...related])
          if (item.moduleId === module.id) item.moduleId = destination.id;
        if (module.note) destination.note = [destination.note, module.name + "\n" + module.note].filter(Boolean).join("\n\n");
      } else {
        plan.tasks = plan.tasks.filter((item) => !ids.has(item.id));
        plan.logs = plan.logs.filter((item) => item.moduleId !== module.id && !ids.has(item.taskId));
        for (const item of related) {
          if (item.moduleId === module.id) item.moduleId = null;
          if (ids.has(item.taskId)) item.taskId = null;
        }
      }
      for (const course of plan.settings.courses) {
        if (course.moduleIds) {
          const linked = course.moduleIds.includes(module.id);
          course.moduleIds = course.moduleIds.filter((id) => id !== module.id);
          if (linked && destination?.group === "literature" && !course.moduleIds.includes(destination.id))
            course.moduleIds.push(destination.id);
        }
        if (!destination && course.taskIds) course.taskIds = course.taskIds.filter((id) => !ids.has(id));
      }
      plan.modules = remove(plan.modules, module.id);
      break;
    }
    case "moveModule": {
      const target = plan.modules.find((item) => item.id === data.target);
      assert(module && target && module !== target && module.group === "literature" &&
        target.group === "literature" && !module.archived && !target.archived, "请选择专业基础内的学科排序。");
      reorderRelative(plan.modules, module, target, data.after);
      break;
    }
    case "task": {
      assert(task || !data.id, "任务不存在。");
      const moduleId = task?.moduleId ?? data.moduleId;
      assert(plan.modules.some((item) => item.id === moduleId && !item.archived), "请选择可用学科。");
      const section = task ? isSection(task) : data.kind === "section";
      const parentId = section ? null : task ? task.parentId : data.parentId || null;
      assert(!parentId || plan.tasks.some((item) => item.id === parentId && item.moduleId === moduleId), "父任务必须属于同一学科。");
      assert(section || Object.hasOwn(statuses, data.status), "请选择任务状态。");
      const resourceIds = data.resourceIds ?? task?.resourceIds ?? [];
      assert(Array.isArray(resourceIds), "请选择资源库里的资料。");
      const available = new Set(referenceResources(plan).map((note) => note.id));
      assert(resourceIds.every((id) => available.has(id)), "所选资料已变更，请重新选择。");
      plan.tasks = put(plan.tasks, {
        id: task?.id ?? crypto.randomUUID(), moduleId, parentId,
        name: named(data.name), kind: section ? "section" : "task",
        ...(section ? { status: task?.status ?? "TODO", hours: task?.hours ?? 0,
          priority: task?.priority ?? 1, deadline: task?.deadline ?? "" }
          : { status: data.status, hours: number(data.hours, 0, 10000),
            priority: number(data.priority, 1, 5), deadline: day(data.deadline) }),
        notes: clean(data.notes), resource: clean(data.resource), resourceIds: [...new Set(resourceIds)],
      });
      break;
    }
    case "toggle":
      assert(task && !isSection(task), "请选择可以标记完成的任务。");
      task.status = task.status === "DONE" ? "TODO" : "DONE";
      break;
    case "makeSection":
      assert(task && module && !module.archived && task.moduleId === module.id && !isSection(task),
        "请将任务放到所属的大板块标题上。");
      task.kind = "section";
      task.parentId = null;
      break;
    case "makeTask":
      assert(isSection(task), "请选择要转为任务的小板块。");
      task.kind = "task";
      break;
    case "moveTaskModule": {
      const destination = plan.modules.find((item) => item.id === data.destination && !item.archived);
      assert(task && destination, "请选择任务和可用板块。");
      const index = taskIndex(plan.tasks);
      const parentId = data.parentId || null;
      const parent = index.byId.get(parentId);
      assert(!parentId || (parent && isSection(parent) && parent.moduleId === destination.id && !isSection(task)),
        "请选择目标大板块里的小板块。");
      const ids = new Set([task.id]);
      const pending = [task.id];
      for (let i = 0; i < pending.length; i++)
        for (const child of index.siblings(pending[i])) { ids.add(child.id); pending.push(child.id); }
      transferTasks(plan, ids, destination);
      task.parentId = parentId;
      const moved = plan.tasks.filter((item) => ids.has(item.id));
      plan.tasks = [...plan.tasks.filter((item) => !ids.has(item.id)), ...moved];
      break;
    }
    case "move": {
      const index = taskIndex(plan.tasks);
      const target = index.byId.get(data.target);
      assert(task && target && task !== target && task.moduleId === target.moduleId && task.parentId === target.parentId, "请选择同级任务排序。");
      reorderRelative(plan.tasks, task, target, data.after);
      break;
    }
    case "removeTask": {
      assert(task, "任务不存在。");
      const index = taskIndex(plan.tasks);
      assert(!index.siblings(task.id).length && !plan.logs.some((log) => log.taskId === task.id) &&
        !plan.notes.some((note) => note.taskId === task.id) &&
        !referenceResources(plan).some((note) => note.isFolder && note.taskId === task.id),
        "请先处理该任务的子任务、学习记录和资料或错题。");
      plan.tasks = remove(plan.tasks, task.id);
      for (const course of plan.settings.courses)
        if (course.taskIds) course.taskIds = course.taskIds.filter((id) => id !== task.id);
      break;
    }
    case "log": {
      const linkedTask = data.taskId && plan.tasks.find((item) => item.id === data.taskId);
      const existing = plan.logs.find((item) => item.id === data.id);
      assert((!data.taskId || linkedTask) && (linkedTask || module), "请选择有效学科或任务。");
      assert(!data.id || existing, "学习记录不存在。");
      assert(!isSection(linkedTask) || existing?.taskId === linkedTask.id, "请选择可执行的任务，或把学时直接记到学科。");
      plan.logs = put(plan.logs, {
        id: data.id || crypto.randomUUID(), moduleId: linkedTask?.moduleId ?? module.id,
        taskId: linkedTask?.id ?? null, hours: number(data.hours, 0.01, 24), date: day(data.date, true), text: clean(data.text),
      });
      break;
    }
    case "removeLog":
      plan.logs = remove(plan.logs, data.id);
      break;
    case "milestone": {
      const rows = plan.milestones ?? [];
      assert(!data.id || rows.some((item) => item.id === data.id), "时间轴节点不存在。");
      plan.milestones = put(rows, { id: data.id || crypto.randomUUID(), ...readMilestone(data) });
      break;
    }
    case "removeMilestone":
      plan.milestones = remove(plan.milestones ?? [], data.id);
      break;
    case "dateNote": {
      const date = day(data.date, true);
      const value = clean(data.text);
      if (value) plan.dates[date] = value;
      else delete plan.dates[date];
      break;
    }
    case "resourceFolder": {
      const folders = plan.resourceFolders ?? [];
      const index = resourceFolderIndex(plan);
      const parentId = data.parentId || null;
      assert(!data.id || index.byId.has(data.id), "文件夹不存在。");
      assert(!parentId || index.byId.has(parentId), "请选择有效的上级文件夹。");
      assert(!data.id || !index.path(parentId).some((folder) => folder.id === data.id),
        "请选择当前文件夹及其子目录以外的位置。");
      plan.resourceFolders = put(folders, { ...index.byId.get(data.id), id: data.id || crypto.randomUUID(), parentId, name: named(data.name) });
      break;
    }
    case "organizeResource": {
      const index = resourceFolderIndex(plan);
      const folder = index.byId.get(data.id);
      const note = libraryResources(plan).find((item) => item.id === data.id);
      assert(folder || note, "找不到要整理的目录项。");
      if (data.operation === "move") {
        const targetId = data.targetId || null;
        assert(!targetId || index.byId.has(targetId), "请选择有效文件夹。");
        assert(!folder || !index.path(targetId).some((item) => item.id === folder.id),
          "请选择当前文件夹及其子目录以外的位置。");
        if (folder) folder.parentId = targetId;
        else note.folderId = targetId;
      } else if (data.operation === "folder") {
        assert(note, "请拖动资源来转换为文件夹。");
        plan.resourceFolders = [...index.byId.values(), {
          id: note.id, parentId: note.folderId ?? null, name: note.title, resource: note,
        }];
        plan.notes = remove(plan.notes, note.id);
      } else {
        assert(data.operation === "resource" && folder, "请拖动文件夹来转换为资源。");
        assert(!index.children.has(folder.id) && !libraryResources(plan).some((item) => item.folderId === folder.id),
          "请先移出文件夹内的内容，再转为资源。");
        plan.notes.push({
          kind: "resource", source: "", text: "", moduleId: null, taskId: null,
          ...folder.resource, id: folder.id, title: folder.name, folderId: folder.parentId ?? null,
        });
        plan.resourceFolders = remove(plan.resourceFolders, folder.id);
      }
      break;
    }
    case "removeResourceFolder": {
      const folders = plan.resourceFolders ?? [];
      assert(folders.some((folder) => folder.id === data.id), "文件夹不存在。");
      assert(!folders.some((folder) => folder.parentId === data.id) &&
        !libraryResources(plan).some((note) => note.folderId === data.id), "请先移出文件夹内的资源和子文件夹。");
      assert(!plan.tasks.some((item) => item.resourceIds?.includes(data.id)) &&
        !folders.find((folder) => folder.id === data.id)?.resource?.taskId, "此文件夹仍与任务关联，可先转回资源再处理关联。");
      plan.resourceFolders = remove(folders, data.id);
      break;
    }
    case "archiveResource": {
      const item = libraryResources(plan).find((note) => note.id === data.id) ??
        (plan.resourceFolders ?? []).find((folder) => folder.id === data.id);
      assert(item, "资源或文件夹不存在。");
      item.archived = data.archived === "yes";
      break;
    }
    case "note": {
      const kind = data.kind === "error" ? "error" : "resource";
      const existing = plan.notes.find((item) => item.id === data.id);
      assert(!data.id || existing?.kind === kind, "记录不存在或分类已变更。");
      const folderId = data.folderId || null;
      if (kind === "resource") {
        assert(!folderId || resourceFolderIndex(plan).byId.has(folderId), "请选择有效文件夹。");
      } else {
        assert(module, "请选择有效学科。");
        const linkedTask = data.taskId && plan.tasks.find((item) => item.id === data.taskId && item.moduleId === module.id);
        assert(!data.taskId || linkedTask, "关联任务必须属于该学科。");
        assert(!isSection(linkedTask) || existing?.taskId === linkedTask.id, "请选择可执行的任务。");
      }
      plan.notes = put(plan.notes, {
        id: data.id || crypto.randomUUID(),
        ...(kind === "resource"
          ? { folderId, moduleId: existing?.moduleId ?? null, taskId: existing?.taskId ?? null,
            archived: data.archived === undefined ? existing?.archived === true : data.archived === "yes" }
          : { moduleId: module.id, taskId: data.taskId || null }),
        kind, title: named(data.title),
        text: clean(data.text), source: clean(data.source), reviewed: data.reviewed === "yes",
      });
      break;
    }
    case "removeNote":
      assert(!plan.tasks.some((item) => item.resourceIds?.includes(data.id)), "这份资料正在被任务使用，请先从这些任务取消引用。");
      plan.notes = remove(plan.notes, data.id);
      break;
    default:
      throw new Error("未知操作。");
  }
  return plan;
}
