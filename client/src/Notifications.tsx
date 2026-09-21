import React, { useEffect, useState } from "react";
type Preferences = {
  inApp: boolean;
  email: boolean;
  push: boolean;
  leadMinutes: number;
  atStart: boolean;
  timeZone: string;
};
type Inbox = {
  preferences: Preferences;
  email: string;
  unread: number;
  configuration: {
    emailReady: boolean;
    pushReady: boolean;
    schedulerReady: boolean;
  };
  items: {
    id: string;
    title: string;
    body: string;
    start: string;
    read: boolean;
  }[];
};
async function request(path: string, body?: unknown) {
  const response = await fetch("/api/reminders" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw Error(
      "Reminders are unavailable. Check that the latest backend is deployed.",
    );
  return response.json();
}
export function Notifications({
  onOpen,
  onCount,
}: {
  onOpen: (start: string) => void;
  onCount: (count: number) => void;
}) {
  const [inbox, setInbox] = useState<Inbox | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    onCount(inbox?.unread || 0);
  }, [inbox?.unread, onCount]);
  useEffect(() => {
    let active = true;
    const load = () =>
      request("")
        .then((data) => {
          if (active) {
            setInbox(data);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function change(patch: Partial<Preferences>) {
    if (!inbox || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/reminders/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inbox.preferences, ...patch }),
      });
      if (!response.ok) throw Error("Unable to save notification preferences.");
      setInbox(await request(""));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function read(id?: string) {
    setBusy(true);
    try {
      await request("/read", id ? { id } : {});
      setInbox(await request(""));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel notification-panel">
      <h2>Notifications {inbox ? `(${inbox.unread} unread)` : ""}</h2>
      {error && <p role="alert">{error}</p>}
      {inbox && (
        <>
          <p>Reminders for your time blocks and meetings.</p>
          <fieldset disabled={busy} className="reminder-settings">
            <legend>Reminder settings</legend>
            <label>
              <input
                type="checkbox"
                checked={inbox.preferences.inApp}
                onChange={(e) => void change({ inApp: e.target.checked })}
              />{" "}
              In-app inbox
            </label>
            <label>
              <input
                type="checkbox"
                checked={inbox.preferences.email}
                onChange={(e) => void change({ email: e.target.checked })}
              />{" "}
              Email reminders to {inbox.email}
            </label>
            {!inbox.configuration.emailReady && (
              <p>Email delivery needs a configured email provider.</p>
            )}
            <label>
              Before the start{" "}
              <select
                value={inbox.preferences.leadMinutes}
                onChange={(e) =>
                  void change({ leadMinutes: Number(e.target.value) })
                }
              >
                {[0, 5, 10, 15, 30].map((n) => (
                  <option key={n} value={n}>
                    {n ? `${n} minutes before` : "No advance reminder"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={inbox.preferences.atStart}
                onChange={(e) => void change({ atStart: e.target.checked })}
              />{" "}
              Also remind me at the start
            </label>
            <p>Time zone: {inbox.preferences.timeZone}</p>
            <button
              className="secondary"
              onClick={() =>
                void change({
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                })
              }
            >
              Use this device’s time zone
            </button>
            <p>
              Mobile push: {inbox.preferences.push ? "enabled" : "off"}. Enable
              push on each device in the FocusFlow Expo app. Browser push is not
              available.
            </p>
            {!inbox.configuration.schedulerReady && (
              <p>Background delivery needs the server scheduler configured.</p>
            )}
          </fieldset>
          <button
            className="secondary"
            disabled={busy || !inbox.unread}
            onClick={() => void read()}
          >
            Mark all as read
          </button>
          {!inbox.items.length && (
            <p>
              No reminders yet. New reminders appear 10 minutes before and at
              the start by default.
            </p>
          )}
          {inbox.items.map((item) => (
            <article className="reminder-item" key={item.id}>
              <h3>
                {!item.read && "• "}
                {item.title}
              </h3>
              <p>{item.body}</p>
              <div className="actions">
                <button
                  className="secondary"
                  onClick={() => onOpen(item.start)}
                >
                  View in calendar
                </button>
                {!item.read && (
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() => void read(item.id)}
                  >
                    Mark as read
                  </button>
                )}
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
