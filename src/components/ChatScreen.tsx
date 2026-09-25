import { useCallback, useState } from "react";

import ConversationList from "./ConversationList.js";
import MoversPanel from "./MoversPanel.js";
import SupervisorChat from "./SupervisorChat.js";

const STORAGE_KEY = "threadId";

const readThreadId = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const saveThreadId = (id: string | null): void => {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked (private mode): the chat still works, it just won't resume on reload
  }
};

/** Conversations on the left, the active chat in the middle, market data on the right. */
export default function ChatScreen({ userId }: { userId: string }) {
  const [threadId, setThreadId] = useState<string | null>(readThreadId);
  // Remounts the chat only when the user switches conversation. A new thread getting its id
  // mid-stream must NOT remount, or the stream in progress would be dropped.
  const [session, setSession] = useState(0);
  const [listVersion, setListVersion] = useState(0);

  const changeThread = useCallback((id: string | null) => {
    setThreadId(id);
    saveThreadId(id); // resume the same conversation on reload
    setListVersion((v) => v + 1);
  }, []);

  const refreshList = useCallback(() => setListVersion((v) => v + 1), []);
  const [listOpen, setListOpen] = useState(false); // phone layout only; wider screens always show it

  const open = (id: string | null) => {
    changeThread(id);
    setSession((s) => s + 1);
    setListOpen(false);
  };

  return (
    <div className="chat-layout">
      <div className="chat-toolbar">
        <button
          onClick={() => setListOpen((v) => !v)}
          aria-expanded={listOpen}
          aria-controls="chat-sidebar"
        >
          {listOpen ? "Hide conversations" : "Conversations"}
        </button>
        <button className="toolbar-new" onClick={() => open(null)}>
          + New
        </button>
      </div>

      <aside id="chat-sidebar" className={listOpen ? "chat-sidebar open" : "chat-sidebar"}>
        <ConversationList
          userId={userId}
          activeId={threadId}
          version={listVersion}
          onSelect={(id) => id !== threadId && open(id)}
          onNew={() => open(null)}
        />
      </aside>

      <main className="app-main">
        <SupervisorChat
          key={session}
          userId={userId}
          threadId={threadId}
          onThreadChange={changeThread}
          onRunEnd={refreshList}
        />
      </main>

      <aside className="app-aside" aria-label="Market data">
        <MoversPanel />
      </aside>
    </div>
  );
}
