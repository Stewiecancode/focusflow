import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  ListTodo,
  CalendarDays,
  Timer,
  Plus,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Check,
  Layers,
  Play,
  Pause,
  Trash2,
  X,
  Sparkles,
} from "lucide-react";
import "./style.css";
import { Notifications } from "./Notifications";
type Meeting = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
};
type Workspace = { id: string; name: string; color: string };
type Project = { id: string; name: string; workspaceId: string };
type Task = {
  id: string;
  title: string;
  projectId: string;
  minutes: number;
  priority: "high" | "medium" | "low";
  done: boolean;
  due: string;
};
type Block = { id: string; taskId: string; start: string; end: string };
type Session = {
  id: string;
  taskId: string;
  minutes: number;
  completedAt: string;
};
type State = {
  workspaces: Workspace[];
  projects: Project[];
  tasks: Task[];
  blocks: Block[];
  sessions: Session[];
  meetings?: Meeting[];
};
const blank: State = {
  workspaces: [],
  projects: [],
  tasks: [],
  blocks: [],
  sessions: [],
};
const uid = () => crypto.randomUUID();
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const time = (s: string) =>
  new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch("/api" + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => {
    throw new Error("The server is unavailable. Please try again shortly.");
  });
  if (!r.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
function App() {
  const [unread, setUnread] = useState(0);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [state, setState] = useState<State>(blank),
    [name, setName] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState("Overview"),
    [workspace, setWorkspace] = useState(""),
    [project, setProject] = useState(""),
    [modal, setModal] = useState(""),
    [editing, setEditing] = useState<Task | null>(null),
    [day, setDay] = useState(dateKey(new Date())),
    [query, setQuery] = useState("");
  const [register, setRegister] = useState(true),
    [focusTask, setFocusTask] = useState(""),
    [duration, setDuration] = useState(25),
    [remaining, setRemaining] = useState(1500),
    [running, setRunning] = useState(false),
    [target, setTarget] = useState(0);
  useEffect(() => {
    api("/state")
      .then((d) => {
        setName(d.name);
        setState(d.state);
        setRevision(d.revision);
      })
      .catch((e) => {
        if (e.message !== "Please sign in.") setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setRemaining(left);
      if (!left) setRunning(false);
    }, 250);
    return () => clearInterval(t);
  }, [running, target]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
        ) || [],
      );
    controls()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = controls(),
        first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal]);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(next: State) {
    const d = await api("/state", "PUT", { state: next, revision });
    setState(next);
    setRevision(d.revision);
  }
  const tasks = state.tasks.filter(
    (t) =>
      (!workspace ||
        state.projects.find((p) => p.id === t.projectId)?.workspaceId ===
          workspace) &&
      (!project || t.projectId === project) &&
      t.title.toLowerCase().includes(query.toLowerCase()),
  );
  const projects = state.projects.filter(
    (p) => !workspace || p.workspaceId === workspace,
  );
  const pending = tasks.filter((t) => !t.done),
    completed = tasks.filter((t) => t.done);
  const blocks = state.blocks
    .filter(
      (b) =>
        tasks.some((t) => t.id === b.taskId) &&
        dateKey(new Date(b.start)) === day,
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const taskWorkspace = (t: Task) =>
    state.workspaces.find(
      (w) =>
        w.id === state.projects.find((p) => p.id === t.projectId)?.workspaceId,
    );
  function close() {
    setModal("");
    setEditing(null);
    setMeeting(null);
  }
  function addTask() {
    setEditing(null);
    setModal(state.projects.length ? "task" : "project");
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await action(async () => {
      const next = structuredClone(state);
      if (modal === "meeting") {
        const start = new Date(String(f.get("start"))),
          end = new Date(String(f.get("end")));
        if (
          !Number.isFinite(start.getTime()) ||
          !Number.isFinite(end.getTime()) ||
          end <= start
        )
          throw Error("Choose an end time after the start.");
        const value: Meeting = {
          id: meeting?.id || uid(),
          title: String(f.get("title")).trim(),
          start: start.toISOString(),
          end: end.toISOString(),
          location: String(f.get("location")).trim(),
        };
        next.meetings = meeting
          ? (next.meetings || []).map((m) => (m.id === meeting.id ? value : m))
          : [...(next.meetings || []), value];
      }
      if (modal === "workspace")
        next.workspaces.push({
          id: uid(),
          name: String(f.get("name")).trim(),
          color: String(f.get("color")),
        });
      if (modal === "project")
        next.projects.push({
          id: uid(),
          name: String(f.get("name")).trim(),
          workspaceId: String(f.get("workspace")),
        });
      if (modal === "task") {
        const task: Task = {
          id: editing?.id || uid(),
          title: String(f.get("title")).trim(),
          projectId: String(f.get("project")),
          minutes: Number(f.get("minutes")),
          priority: f.get("priority") as Task["priority"],
          done: editing?.done || false,
          due: String(f.get("due")),
        };
        next.tasks = editing
          ? next.tasks.map((t) => (t.id === editing.id ? task : t))
          : [...next.tasks, task];
      }
      if (modal === "block") {
        const start = new Date(String(f.get("start"))),
          task = next.tasks.find((t) => t.id === f.get("task"))!;
        next.blocks.push({
          id: uid(),
          taskId: task.id,
          start: start.toISOString(),
          end: new Date(start.getTime() + task.minutes * 60000).toISOString(),
        });
      }
      if (modal === "schedule") {
        const d = await api("/schedule", "POST", {
          start: new Date(String(f.get("start"))).toISOString(),
          end: new Date(String(f.get("end"))).toISOString(),
          revision,
        });
        setState(d.state);
        setRevision(d.revision);
        setNotice(
          `${d.state.blocks.length - state.blocks.length} tasks scheduled. Tasks that do not fit remain unscheduled.`,
        );
        close();
        return;
      }
      await save(next);
      close();
    });
  }
  function row(t: Task) {
    const w = taskWorkspace(t);
    return (
      <div className={"task-row " + (t.done ? "done" : "")} key={t.id}>
        <button
          className="check"
          aria-label={t.done ? "Reopen " + t.title : "Complete " + t.title}
          disabled={busy}
          onClick={() =>
            action(() =>
              save({
                ...state,
                tasks: state.tasks.map((x) =>
                  x.id === t.id ? { ...x, done: !x.done } : x,
                ),
              }),
            )
          }
        >
          {t.done && <Check size={14} />}
        </button>
        <button
          className="task-title"
          onClick={() => {
            setEditing(t);
            setModal("task");
          }}
        >
          <strong>{t.title}</strong>
          <span>
            <i style={{ background: w?.color }} />
            {w?.name} / {state.projects.find((p) => p.id === t.projectId)?.name}
          </span>
        </button>
        <span className={"priority " + t.priority}>{t.priority}</span>
        <span className="estimate">{t.minutes} min</span>
        <button
          className="icon"
          title="Focus on task"
          aria-label={"Focus on " + t.title}
          onClick={() => {
            setFocusTask(t.id);
            setView("Focus");
          }}
        >
          <Play size={16} />
        </button>
      </div>
    );
  }
  if (loading) return <div className="loading">Loading FocusFlow…</div>;
  if (!name)
    return (
      <div className="auth">
        <div className="auth-story">
          <div className="brand">
            <img className="brand-icon" src="/logo.svg" alt="" />
            FocusFlow
          </div>
          <div>
            <span className="eyebrow">SPACE TO THINK. ROOM TO DO.</span>
            <h1>
              Your day,
              <br />
              with intention.
            </h1>
            <p>Bring your tasks, time, and attention together.</p>
            <div className="auth-lines">
              <span>
                01 <b>Organize what matters</b>
              </span>
              <span>
                02 <b>Make time for it</b>
              </span>
              <span>
                03 <b>Find your focus</b>
              </span>
            </div>
          </div>
          <small>A little clarity goes a long way.</small>
        </div>
        <main className="auth-form">
          <span className="eyebrow">WELCOME TO FOCUSFLOW</span>
          <h2>
            {register ? "Make space for your next step." : "Welcome back."}
          </h2>
          <p>
            {register
              ? "Your workspace starts with you."
              : "Pick up where you left off."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action(async () => {
                await api(
                  "/auth/" + (register ? "register" : "login"),
                  "POST",
                  Object.fromEntries(f),
                );
                const d = await api("/state");
                setName(d.name);
                setState(d.state);
                setRevision(d.revision);
              });
            }}
          >
            {register && (
              <label>
                What should we call you?
                <input
                  name="name"
                  autoComplete="given-name"
                  maxLength={80}
                  required
                  placeholder="Your name"
                />
              </label>
            )}
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                minLength={10}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
                required
                placeholder="At least 10 characters"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
          <small>Only your name. Email is used for sign-in.</small>
        </main>
      </div>
    );
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <img className="brand-icon" src="/logo.svg" alt="" />
          FocusFlow
        </div>
        <span className="nav-label">YOUR SPACE</span>
        <nav>
          {[
            [LayoutDashboard, "Overview"],
            [ListTodo, "Tasks"],
            [CalendarDays, "Calendar"],
            [Timer, "Focus"],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Timer;
            return (
              <button
                key={String(label)}
                className={view === label ? "active" : ""}
                onClick={() => setView(String(label))}
              >
                <I size={19} />
                {String(label)}
                {label === "Tasks" && (
                  <span className="count">
                    {state.tasks.filter((t) => !t.done).length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="workspace-title">
          <span className="nav-label">WORKSPACES</span>
          <button
            className="icon"
            aria-label="Create workspace"
            onClick={() => setModal("workspace")}
          >
            <Plus size={17} />
          </button>
        </div>
        <button
          className={"workspace " + (!workspace ? "selected" : "")}
          onClick={() => {
            setWorkspace("");
            setProject("");
          }}
        >
          <Layers size={17} />
          All workspaces
        </button>
        {state.workspaces.map((w) => (
          <button
            className={"workspace " + (workspace === w.id ? "selected" : "")}
            key={w.id}
            onClick={() => {
              setWorkspace(w.id);
              setProject("");
            }}
          >
            <i style={{ background: w.color }} />
            {w.name}
          </button>
        ))}
        {!state.workspaces.length && (
          <p className="side-hint">
            Create a workspace.
            <br />
            Give it any name.
          </p>
        )}
        <div className="sidebar-bottom">
          <div className="avatar">{name[0].toUpperCase()}</div>
          <span>
            {name}
            <small>Your workspace</small>
          </span>
          <button
            className="icon"
            aria-label="Sign out"
            onClick={() =>
              action(async () => {
                await api("/logout", "POST");
                setName("");
                setState(blank);
                setRunning(false);
                setRemaining(1500);
                setFocusTask("");
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="body">
        <header>
          <span>
            {workspace
              ? state.workspaces.find((w) => w.id === workspace)?.name
              : "All workspaces"}{" "}
            <span className="slash">/</span> <b>{view}</b>
          </span>
          <button
            className="secondary"
            onClick={() => setView("Notifications")}
          >
            Notifications {unread > 0 ? `(${unread})` : ""}
          </button>
          <span className="header-date">
            {new Date().toLocaleDateString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {view === "Overview"
                  ? "A LITTLE CLARITY, EVERY DAY"
                  : "YOUR TIME, YOUR INTENTION"}
              </span>
              <h1>
                {view === "Overview"
                  ? `Hello, ${name}.`
                  : view === "Focus"
                    ? "One thing at a time."
                    : view}
              </h1>
              <p>
                {view === "Overview"
                  ? "Let’s make room for what matters."
                  : view === "Calendar"
                    ? "One calendar for everything you’re working on."
                    : view === "Tasks"
                      ? "Capture it. Plan it. Move it forward."
                      : "Give your attention somewhere to land."}
              </p>
            </div>
            <button className="primary" onClick={addTask}>
              <Plus size={18} />
              New task
            </button>
          </div>
          {error && (
            <div role="alert" className="error banner">
              {error}
              <button
                className="icon"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice banner">
              {notice}
              <button
                className="icon"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view !== "Focus" && (
            <div className="filters">
              <select
                aria-label="Filter by workspace"
                value={workspace}
                onChange={(e) => {
                  setWorkspace(e.target.value);
                  setProject("");
                }}
              >
                <option value="">All workspaces</option>
                {state.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button
                className="text-button"
                onClick={() => setModal("workspace")}
              >
                <Plus size={16} />
                Workspace
              </button>
              <select
                aria-label="Filter by project"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="text-button"
                onClick={() =>
                  setModal(state.workspaces.length ? "project" : "workspace")
                }
              >
                <Plus size={16} />
                New project
              </button>
              <span className="filter-spacer" />
              <input
                aria-label="Search tasks"
                placeholder="Search tasks…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {view === "Overview" && (
            <>
              <section className="stats">
                <article>
                  <span>Open tasks</span>
                  <strong>
                    {pending.length}
                    <ListTodo size={22} />
                  </strong>
                  <small>{state.workspaces.length} workspaces, your way</small>
                </article>
                <article>
                  <span>Completed</span>
                  <strong>
                    {completed.length}
                    <Check size={22} />
                  </strong>
                  <small>
                    {tasks.length
                      ? Math.round((completed.length / tasks.length) * 100)
                      : 0}
                    % of tasks finished
                  </small>
                </article>
                <article>
                  <span>Focus time today</span>
                  <strong>
                    {state.sessions
                      .filter(
                        (s) =>
                          tasks.some((t) => t.id === s.taskId) &&
                          dateKey(new Date(s.completedAt)) ===
                            dateKey(new Date()),
                      )
                      .reduce((n, s) => n + s.minutes, 0)}
                    <em>min</em>
                    <Timer size={22} />
                  </strong>
                  <small>Small steps add up</small>
                </article>
              </section>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-title">
                    <h2>
                      Up next <span>{pending.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setView("Tasks")}
                    >
                      View all <ArrowUpRight size={16} />
                    </button>
                  </div>
                  {pending.slice(0, 5).map(row)}
                  {!pending.length && (
                    <div className="empty">
                      <ListTodo size={32} />
                      <h3>
                        {tasks.length
                          ? "A little breathing room."
                          : "Start with one small task."}
                      </h3>
                      <p>
                        {tasks.length
                          ? "Your tasks are complete. Plan what comes next."
                          : "Create a workspace and project, then add what you want to do."}
                      </p>
                      <button
                        className="secondary"
                        onClick={() =>
                          setModal(
                            state.workspaces.length
                              ? state.projects.length
                                ? "task"
                                : "project"
                              : "workspace",
                          )
                        }
                      >
                        {state.workspaces.length
                          ? "Add your next step"
                          : "Create a workspace"}
                        <Plus size={16} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="focus-card">
                  <span className="eyebrow">PROTECT YOUR ATTENTION</span>
                  <Timer size={34} />
                  <h2>
                    Less switching.
                    <br />
                    More doing.
                  </h2>
                  <p>
                    Choose one task and give it
                    <br />
                    25 uninterrupted minutes.
                  </p>
                  <button onClick={() => setView("Focus")}>
                    Start a focus session <ArrowUpRight size={18} />
                  </button>
                </section>
              </div>
              <section className="panel agenda">
                <div className="panel-title">
                  <h2>On your calendar</h2>
                  <button
                    className="text-button"
                    onClick={() => setView("Calendar")}
                  >
                    Open calendar <ArrowUpRight size={16} />
                  </button>
                </div>
                {blocks.length ? (
                  blocks.slice(0, 3).map((b) => (
                    <div className="agenda-row" key={b.id}>
                      <span>
                        {time(b.start)} — {time(b.end)}
                      </span>
                      <strong>
                        {state.tasks.find((t) => t.id === b.taskId)?.title}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p className="quiet">
                    Your day has room. Schedule a task to give it a place.
                  </p>
                )}
              </section>
            </>
          )}
          {view === "Tasks" && (
            <section className="panel">
              <div className="panel-title">
                <h2>
                  Your tasks <span>{tasks.length}</span>
                </h2>
                <button
                  className="text-button"
                  onClick={() => setModal("schedule")}
                >
                  <Sparkles size={16} />
                  Auto-schedule
                </button>
              </div>
              {pending.map(row)}
              {completed.length > 0 && (
                <div className="completed-label">COMPLETED</div>
              )}
              {completed.map(row)}
              {!tasks.length && (
                <div className="empty">
                  <ListTodo size={32} />
                  <h3>No tasks here yet.</h3>
                  <p>Add a task or change your filters.</p>
                  <button className="secondary" onClick={addTask}>
                    Add task
                  </button>
                </div>
              )}
            </section>
          )}
          <div hidden={view !== "Notifications"}>
            <Notifications
              onCount={setUnread}
              onOpen={(start) => {
                setDay(dateKey(new Date(start)));
                setView("Calendar");
              }}
            />
          </div>
          {view === "Calendar" && (
            <section className="panel calendar">
              <div className="panel-title">
                <div className="day-controls">
                  <button
                    className="icon"
                    aria-label="Previous day"
                    onClick={() => {
                      const d = new Date(day + "T12:00");
                      d.setDate(d.getDate() - 1);
                      setDay(dateKey(d));
                    }}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <input
                    aria-label="Calendar date"
                    type="date"
                    value={day}
                    onChange={(e) =>
                      setDay(e.target.value || dateKey(new Date()))
                    }
                  />
                  <button
                    className="icon"
                    aria-label="Next day"
                    onClick={() => {
                      const d = new Date(day + "T12:00");
                      d.setDate(d.getDate() + 1);
                      setDay(dateKey(d));
                    }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => setModal("schedule")}
                  >
                    <Sparkles size={16} />
                    Auto-schedule
                  </button>
                  <button className="primary" onClick={() => setModal("block")}>
                    <Plus size={16} />
                    Time block
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setMeeting(null);
                      setModal("meeting");
                    }}
                  >
                    New meeting
                  </button>
                </div>
              </div>
              <div className="calendar-grid">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div className="hour" key={hour}>
                    <span>{String(hour).padStart(2, "0")}:00</span>
                    <div>
                      {(state.meetings || [])
                        .filter(
                          (m) =>
                            dateKey(new Date(m.start)) === day &&
                            new Date(m.start).getHours() === hour,
                        )
                        .map((m) => (
                          <div
                            className="calendar-block meeting-block"
                            key={m.id}
                          >
                            <button
                              className="task-title"
                              onClick={() => {
                                setMeeting(m);
                                setModal("meeting");
                              }}
                            >
                              <strong>{m.title}</strong>
                              <span>
                                {time(m.start)} –{" "}
                                {new Date(m.end).toLocaleString()} · Meeting{" "}
                                {m.location && `· ${m.location}`}
                              </span>
                            </button>
                            <button
                              className="icon"
                              aria-label={"Delete meeting " + m.title}
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete ${m.title} and its future reminders?`,
                                  )
                                )
                                  void action(() =>
                                    save({
                                      ...state,
                                      meetings: (state.meetings || []).filter(
                                        (x) => x.id !== m.id,
                                      ),
                                    }),
                                  );
                              }}
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                      {blocks
                        .filter((b) => new Date(b.start).getHours() === hour)
                        .map((b) => {
                          const t = state.tasks.find((t) => t.id === b.taskId)!;
                          return (
                            <div
                              className="calendar-block"
                              key={b.id}
                              style={{
                                borderLeftColor: taskWorkspace(t)?.color,
                              }}
                            >
                              <div>
                                <strong>{t.title}</strong>
                                <span>
                                  {time(b.start)} – {time(b.end)} ·{" "}
                                  {taskWorkspace(t)?.name}
                                </span>
                              </div>
                              <button
                                className="icon"
                                aria-label={"Unschedule " + t.title}
                                disabled={busy}
                                onClick={() =>
                                  action(() =>
                                    save({
                                      ...state,
                                      blocks: state.blocks.filter(
                                        (x) => x.id !== b.id,
                                      ),
                                    }),
                                  )
                                }
                              >
                                <X size={16} />
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {view === "Focus" && (
            <div className="focus-layout">
              <section className="timer-panel">
                <span className="eyebrow">FOCUS SESSION</span>
                <h2>
                  {running
                    ? "You’re right where you need to be."
                    : remaining === 0
                      ? "A little progress, made."
                      : "Choose your next small win."}
                </h2>
                <select
                  aria-label="Task to focus on"
                  disabled={running || remaining !== duration * 60}
                  value={focusTask}
                  onChange={(e) => setFocusTask(e.target.value)}
                >
                  <option value="">Choose a task</option>
                  {state.tasks
                    .filter((t) => !t.done || t.id === focusTask)
                    .map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
                <div className={"timer " + (running ? "running" : "")}>
                  <span>
                    {String(Math.floor(remaining / 60)).padStart(2, "0")}
                    <i>:</i>
                    {String(remaining % 60).padStart(2, "0")}
                  </span>
                  <small>
                    {running
                      ? "ONE TASK. YOUR FULL ATTENTION."
                      : remaining === 0
                        ? "SESSION COMPLETE"
                        : "READY WHEN YOU ARE"}
                  </small>
                </div>
                <div className="durations">
                  {[15, 25, 50].map((n) => (
                    <button
                      key={n}
                      disabled={running || remaining !== duration * 60}
                      className={duration === n ? "selected" : ""}
                      onClick={() => {
                        setDuration(n);
                        setRemaining(n * 60);
                      }}
                    >
                      {n} min
                    </button>
                  ))}
                </div>
                <div className="timer-actions">
                  <button
                    className="primary"
                    disabled={!focusTask || remaining === 0}
                    onClick={() => {
                      if (!running) setTarget(Date.now() + remaining * 1000);
                      setRunning(!running);
                    }}
                  >
                    {running ? <Pause size={18} /> : <Play size={18} />}{" "}
                    {running ? "Pause" : "Start focus"}
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      busy || !focusTask || duration * 60 - remaining < 60
                    }
                    onClick={() =>
                      action(async () => {
                        await save({
                          ...state,
                          sessions: [
                            ...state.sessions,
                            {
                              id: uid(),
                              taskId: focusTask,
                              minutes: Math.floor(
                                (duration * 60 - remaining) / 60,
                              ),
                              completedAt: new Date().toISOString(),
                            },
                          ],
                        });
                        setRunning(false);
                        setRemaining(duration * 60);
                        setNotice("Focus session saved. Every minute counts.");
                      })
                    }
                  >
                    Save session
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setRunning(false);
                      setRemaining(duration * 60);
                    }}
                  >
                    Reset
                  </button>
                </div>
                <p className="quiet">
                  Save after at least one minute. Reset discards this session.
                </p>
              </section>
              <section className="panel">
                <div className="panel-title">
                  <h2>Recent sessions</h2>
                </div>
                {[...state.sessions]
                  .reverse()
                  .slice(0, 8)
                  .map((s) => (
                    <div className="session" key={s.id}>
                      <Timer size={18} />
                      <div>
                        <strong>
                          {state.tasks.find((t) => t.id === s.taskId)?.title}
                        </strong>
                        <small>
                          {new Date(s.completedAt).toLocaleDateString()} ·{" "}
                          {s.minutes} min
                        </small>
                      </div>
                    </div>
                  ))}
                {!state.sessions.length && (
                  <p className="quiet">
                    Your completed focus sessions will appear here.
                  </p>
                )}
              </section>
            </div>
          )}
          <footer>
            Make room for what matters.<span>FocusFlow</span>
          </footer>
        </main>
      </div>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <div className="panel-title">
              <h2 id="modal-title">
                {modal === "meeting"
                  ? meeting
                    ? "Edit meeting"
                    : "New meeting"
                  : modal === "workspace"
                    ? "Create a workspace"
                    : modal === "project"
                      ? "Create a project"
                      : modal === "task"
                        ? editing
                          ? "Edit task"
                          : "New task"
                        : modal === "schedule"
                          ? "Plan your time"
                          : "Schedule a task"}
              </h2>
              <button
                className="icon"
                aria-label="Close dialog"
                onClick={close}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submit}>
              {modal === "meeting" && (
                <>
                  <label>
                    Meeting title
                    <input
                      name="title"
                      required
                      maxLength={120}
                      defaultValue={meeting?.title || ""}
                    />
                  </label>
                  <label>
                    Starts
                    <input
                      name="start"
                      type="datetime-local"
                      required
                      defaultValue={
                        meeting
                          ? `${dateKey(new Date(meeting.start))}T${String(new Date(meeting.start).getHours()).padStart(2, "0")}:${String(new Date(meeting.start).getMinutes()).padStart(2, "0")}`
                          : `${day}T09:00`
                      }
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      name="end"
                      type="datetime-local"
                      required
                      defaultValue={
                        meeting
                          ? `${dateKey(new Date(meeting.end))}T${String(new Date(meeting.end).getHours()).padStart(2, "0")}:${String(new Date(meeting.end).getMinutes()).padStart(2, "0")}`
                          : `${day}T09:30`
                      }
                    />
                  </label>
                  <label>
                    Location or meeting link
                    <input
                      name="location"
                      maxLength={300}
                      defaultValue={meeting?.location || ""}
                    />
                  </label>
                  <p>
                    Times use this device’s time zone. Set reminder preferences
                    in Notifications.
                  </p>
                </>
              )}
              {(modal === "workspace" || modal === "project") && (
                <label>
                  Name
                  <input
                    autoFocus
                    name="name"
                    maxLength={120}
                    required
                    placeholder={
                      modal === "workspace"
                        ? "A name that makes sense to you"
                        : "What are you working toward?"
                    }
                  />
                </label>
              )}
              {modal === "workspace" && (
                <label>
                  Color
                  <input type="color" name="color" defaultValue="#5b5ce2" />
                </label>
              )}
              {modal === "project" &&
                (state.workspaces.length ? (
                  <label>
                    Workspace
                    <select
                      name="workspace"
                      defaultValue={workspace || state.workspaces[0].id}
                    >
                      {state.workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p>
                    Create a workspace first.{" "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setModal("workspace")}
                    >
                      Create workspace
                    </button>
                  </p>
                ))}
              {modal === "task" && (
                <>
                  <label>
                    Task
                    <input
                      autoFocus
                      name="title"
                      required
                      maxLength={120}
                      defaultValue={editing?.title}
                    />
                  </label>
                  <label>
                    Project
                    <select
                      name="project"
                      required
                      defaultValue={
                        editing?.projectId || project || state.projects[0]?.id
                      }
                    >
                      {state.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {
                            state.workspaces.find((w) => w.id === p.workspaceId)
                              ?.name
                          }{" "}
                          / {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid">
                    <label>
                      Estimate (minutes)
                      <input
                        name="minutes"
                        type="number"
                        min="5"
                        max="480"
                        required
                        defaultValue={editing?.minutes || 30}
                      />
                    </label>
                    <label>
                      Priority
                      <select
                        name="priority"
                        defaultValue={editing?.priority || "medium"}
                      >
                        <option>high</option>
                        <option>medium</option>
                        <option>low</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Due date (optional)
                    <input type="date" name="due" defaultValue={editing?.due} />
                  </label>
                </>
              )}
              {modal === "block" && (
                <label>
                  Task
                  <select name="task" required>
                    <option value="">Choose a task</option>
                    {state.tasks
                      .filter((t) => !t.done)
                      .map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.title} · {t.minutes} min
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {(modal === "block" || modal === "schedule") && (
                <label>
                  {modal === "schedule" ? "Available from" : "Start"}
                  <input
                    type="datetime-local"
                    name="start"
                    required
                    defaultValue={day + "T09:00"}
                  />
                </label>
              )}
              {modal === "schedule" && (
                <>
                  <label>
                    Available until
                    <input
                      type="datetime-local"
                      name="end"
                      required
                      defaultValue={day + "T17:00"}
                    />
                  </label>
                  <p className="quiet">
                    Plans unscheduled tasks across all workspaces, by due date
                    then priority. Existing blocks are preserved. Tasks that do
                    not fit stay in your list.
                  </p>
                </>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                {editing && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      setModal("delete");
                    }}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                )}
                {modal === "delete" ? (
                  <>
                    <p>
                      Delete “{editing?.title}”, its calendar blocks and focus
                      history?
                    </p>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          await save({
                            ...state,
                            tasks: state.tasks.filter(
                              (t) => t.id !== editing?.id,
                            ),
                            blocks: state.blocks.filter(
                              (b) => b.taskId !== editing?.id,
                            ),
                            sessions: state.sessions.filter(
                              (s) => s.taskId !== editing?.id,
                            ),
                          });
                          close();
                        })
                      }
                    >
                      Delete permanently
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={
                      busy || (modal === "project" && !state.workspaces.length)
                    }
                  >
                    {busy
                      ? "Saving…"
                      : modal === "schedule"
                        ? "Schedule tasks"
                        : "Save"}
                  </button>
                )}
                <button type="button" className="secondary" onClick={close}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
