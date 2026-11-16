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
    tasks: [], logs: [], notes: [], resourceFolders: [], dates: {},
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
  return { byId, children, path };
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

function reorderRelative(rows, item, target, after) {
  const from = rows.indexOf(item);
  const targetIndex = rows.indexOf(target);
  rows.splice(from, 1);
  rows.splice(rows.indexOf(target) + ((after ?? (from < targetIndex)) ? 1 : 0), 0, item);
}

export function apply(plan, { action, data = {} }) {
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
          ? { folderId, moduleId: existing?.moduleId ?? null, taskId: existing?.taskId ?? null }
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
