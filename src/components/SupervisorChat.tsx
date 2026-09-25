import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import type { Message } from "@langchain/langgraph-sdk";

import { AGENT_LABELS, type AgentName, type Task } from "../shared/types.js";
import { LANGGRAPH_URL as API_URL } from "../hooks/langgraph.js";
import LoaderComponent from "./loaderComponent/index.js";

/** Mirrors the fields of SupervisorState the UI reads. */
interface SupervisorState {
  messages: Message[];
  dispatch?: Task[];
  round?: number;
}

function describeUpdate(
  node: string,
  data: Partial<SupervisorState> | undefined,
): string | null {
  const next = (data?.dispatch ?? []).map((task) => AGENT_LABELS[task.agent]);
  console.log("Agent :==> " + node);
  console.log("Agent Data:==> " + JSON.stringify(data));

  if (node === "plan") return `Planned: ${next.join(", ")}`;
  if (node === "review")
    return next.length
      ? `Reviewing, then asking ${next.join(", ")}`
      : "Reviewed all findings";
  if (node === "synthesize") return "Writing the answer";
  if (node in AGENT_LABELS)
    return `${AGENT_LABELS[node as AgentName]} finished`;
  return null;
}

export interface SupervisorChatProps {
  userId: string;
  /** null = a new conversation; the server creates the thread on the first send. */
  threadId: string | null;
  onThreadChange: (id: string | null) => void;
  /** Called when a reply finishes, so the conversation list can refresh. */
  onRunEnd?: () => void;
}

export default function SupervisorChat({
  userId,
  threadId,
  onThreadChange,
  onRunEnd,
}: SupervisorChatProps) {
  const [input, setInput] = useState("");
  const [progress, setProgress] = useState<string[]>([]);

  const thread = useStream<SupervisorState>({
    apiUrl: API_URL,
    assistantId: "supervisor", // key in langgraph.json
    messagesKey: "messages",
    threadId,
    onThreadId: (id: string) => onThreadChange(id),
    onUpdateEvent: (event: Record<string, unknown>) => {
      const lines = Object.entries(event)
        .map(([node, data]) =>
          describeUpdate(node, data as Partial<SupervisorState>),
        )
        .filter((line): line is string => line !== null);
      if (lines.length) setProgress((previous) => [...previous, ...lines]);
    },
  });

  // The dev server can forget threads (restart, upgrade); start fresh instead of erroring forever.
  const errorText =
    thread.error instanceof Error
      ? thread.error.message
      : String(thread.error ?? "");
  useEffect(() => {
    if (threadId && /not found/i.test(errorText)) onThreadChange(null);
  }, [threadId, errorText, onThreadChange]);

  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !thread.isLoading) onRunEnd?.();
    wasLoading.current = thread.isLoading;
  }, [thread.isLoading, onRunEnd]);

  const send = (): void => {
    console.log("send :==> Clicked");

    const text = input.trim();
    if (!text || thread.isLoading) return;
    setInput("");
    setProgress([]);
    // Client-side id: the optimistic bubble and the server's copy share it, so the React key
    // is stable from the moment you hit Send (LangGraph keeps ids it's given).
    const message: Message = { id: crypto.randomUUID(), type: "human", content: text };
    thread.submit(
      { messages: [message] },
      {
        config: { configurable: { user_id: userId } }, // plan() reads the long-term profile with this
        metadata: { user_id: userId }, // tags a new thread so the conversation list can find it
        streamMode: ["updates", "messages-tuple"],
        optimisticValues: (previous) => ({
          ...previous,
          messages: [...(previous.messages ?? []), message],
        }),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") send();
  };

  const visible = thread.messages.filter(
    (message) => message.type === "human" || message.type === "ai",
  );

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "16px 20px 24px",
        display: "flex",
        flexDirection: "column",
        minHeight: "70vh",
      }}
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}
      >
        {visible.map((message, index) => (
          <div
            key={message.id ?? `msg-${index}`} // fallback for any message that arrives without an id
            style={{
              alignSelf: message.type === "human" ? "flex-end" : "flex-start",
              background: message.type === "human" ? "#e8eef7" : "#f4f5f2",
              padding: "10px 14px",
              borderRadius: 12,
              maxWidth: "85%",
              whiteSpace: "pre-wrap",
              lineHeight: 1.6,
            }}
          >
            {typeof message.content === "string"
              ? message.content
              : message.content
                  .map((block) => ("text" in block ? block.text : ""))
                  .join("")}
          </div>
        ))}
      </div>

      {thread.isLoading && progress.length > 0 && (
        <ul
          aria-live="polite"
          style={{
            color: "#5f6368",
            fontSize: 14,
            margin: "12px 0",
            paddingLeft: 18,
          }}
        >
          {progress.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {thread.isLoading && (
        <div
          style={{
            display: "flex",
            flex: 1,
            justifyContent: "flex-end",
            alignItems: "center",
            margin: 10,
          }}
        >
          <LoaderComponent />
        </div>
      )}

      {thread.error != null && (
        <p role="alert" style={{ color: "#b3261e" }}>
          Couldn&apos;t reach the assistant. Check the LangGraph server at{" "}
          {API_URL}.
          {errorText && (
            <span style={{ display: "block", fontSize: 13 }}>{errorText}</span>
          )}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your portfolio, taxes, goals or the market"
          aria-label="Message"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #c7c7c7",
          }}
        />
        {thread.isLoading ? (
          <button onClick={() => thread.stop()} style={{ borderRadius: 10 }}>
            Stop
          </button>
        ) : (
          <button
            onClick={send}
            style={{ borderRadius: 10 }}
            disabled={!input.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
