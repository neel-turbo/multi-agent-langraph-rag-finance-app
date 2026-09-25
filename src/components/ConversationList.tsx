import { useEffect, useState } from "react";
import type { Message, Thread } from "@langchain/langgraph-sdk";

import { langgraph } from "../hooks/langgraph.js";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

const textOf = (message: Message): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((block) => ("text" in block ? block.text : "")).join("");

function toConversation(thread: Thread<{ messages?: Message[] }>): Conversation {
  const first = thread.values?.messages?.find((message) => message.type === "human");
  const title = first ? textOf(first).trim() : "";
  return { id: thread.thread_id, title: title || "New conversation", updatedAt: thread.updated_at };
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export interface ConversationListProps {
  userId: string;
  activeId: string | null;
  /** Bump to re-fetch, e.g. after a run finishes or a thread is created. */
  version: number;
  onSelect: (id: string) => void;
  onNew: () => void;
}

/** Past conversations for this user, newest first. Threads are tagged with user_id when created. */
export default function ConversationList({ userId, activeId, version, onSelect, onNew }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    langgraph.threads
      .search<{ messages?: Message[] }>({
        metadata: { user_id: userId },
        limit: 50,
        sortBy: "updated_at",
        sortOrder: "desc",
      })
      .then((threads) => {
        if (cancelled) return;
        setConversations(threads.map(toConversation));
        setError(null);
      })
      .catch((err: unknown) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  return (
    <nav className="conversations" aria-label="Conversations">
      <button className="new-chat" onClick={onNew}>
        + New conversation
      </button>

      {error && <p className="muted small">Couldn&apos;t load conversations ({error}).</p>}
      {!error && conversations?.length === 0 && <p className="muted small">No conversations yet.</p>}

      <ul>
        {conversations?.map((conversation) => (
          <li key={conversation.id}>
            <button
              className={conversation.id === activeId ? "conversation active" : "conversation"}
              aria-current={conversation.id === activeId ? "true" : undefined}
              onClick={() => onSelect(conversation.id)}
              title={conversation.title}
            >
              <span className="conversation-title">{conversation.title}</span>
              <span className="conversation-time">{relativeTime(conversation.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
