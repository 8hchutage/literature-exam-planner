import { apply, initialPlan } from "./model.js";

let database;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open("literature-exam-planner:" + location.pathname.replace(/(?:index\.html)?$/, ""), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("plans");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.catch(() => { database = undefined; });
  return database;
}

export async function requestPlan(options = {}) {
  const editing = options.method === "POST";
  const input = editing ? JSON.parse(options.body) : null;
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("plans", editing ? "readwrite" : "readonly");
      const store = tx.objectStore("plans");
      const read = store.get("personal");
      let response;
      read.onsuccess = () => {
        const saved = read.result ?? { revision: 0, plan: initialPlan() };
        if (!editing) {
          response = Response.json(saved);
          return;
        }
        if (input.revision !== saved.revision) {
          response = Response.json({ error: "另一个网页标签刚更新了计划，请重试。" }, { status: 409 });
          return;
        }
        try {
          apply(saved.plan, input);
        } catch (error) {
          response = Response.json({ error: error.message }, { status: 400 });
          return;
        }
        saved.revision += 1;
        store.put(saved, "personal");
        response = Response.json(saved);
      };
      tx.oncomplete = () => resolve(response);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return Response.json({ error: "浏览器无法保存学习记录，请检查存储权限后重试。" }, { status: 503 });
  }
}
