"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { notifyInApp } from "@/lib/in-app-notifications";
import { supabaseClient } from "@/lib/supabase/client";

type TripChatRole = "customer" | "driver";

type TripMessage = {
  id: string;
  trip_id: string;
  sender_user_id: string;
  sender_role: TripChatRole;
  body: string;
  created_at: string;
  read_at: string | null;
};

type MessagesResponse = {
  ok?: boolean;
  error?: string;
  messages?: TripMessage[];
  role?: TripChatRole;
  canSend?: boolean;
  readOnlyReason?: string | null;
  unreadCount?: number;
};

type SendResponse = {
  ok?: boolean;
  error?: string;
  message?: TripMessage;
};

type Props = {
  tripId: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  buttonClassName?: string;
  initialOpen?: boolean;
};

const MAX_MESSAGE_LENGTH = 1000;
const SEND_FAILURE_MESSAGE = "Message could not be sent. Please try again.";

class TripChatErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[trip-chat] render failed", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 z-[10000] bg-slate-950/45 backdrop-blur-sm">
        <div className="flex min-h-[100dvh] items-end justify-center p-0 sm:items-center sm:p-5">
          <section className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-red-600">
              Chat needs attention
            </div>
            <h2 className="mt-2 text-xl font-black text-slate-950">
              Chat display refreshed
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The trip is safe. Reopen chat and try again.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="moovu-btn moovu-btn-secondary"
                onClick={this.props.onClose}
              >
                Close
              </button>
              <button
                type="button"
                className="moovu-btn moovu-btn-primary"
                onClick={() => {
                  this.setState({ hasError: false });
                  this.props.onRetry();
                }}
              >
                Reopen chat
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }
}

function safeIsoDate(value: unknown) {
  if (typeof value !== "string") return new Date().toISOString();
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? value : new Date().toISOString();
}

function sanitizeMessage(value: unknown): TripMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<TripMessage>;
  const senderRole = record.sender_role === "driver" ? "driver" : "customer";
  const id = typeof record.id === "string" && record.id
    ? record.id
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = typeof record.body === "string" ? record.body : "";
  if (!body.trim()) return null;
  const messageTripId = typeof record.trip_id === "string" ? record.trip_id : "";
  const senderUserId = typeof record.sender_user_id === "string" ? record.sender_user_id : "";

  return {
    id,
    trip_id: messageTripId,
    sender_user_id: senderUserId,
    sender_role: senderRole,
    body: body.trim(),
    created_at: safeIsoDate(record.created_at),
    read_at: typeof record.read_at === "string" ? record.read_at : null,
  };
}

function normalizeMessages(values: unknown) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const messages: TripMessage[] = [];

  for (const value of values) {
    const message = sanitizeMessage(value);
    if (!message || seen.has(message.id)) continue;
    seen.add(message.id);
    messages.push(message);
  }

  return messages;
}

function safeDateMs(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatMessageTime(value: string) {
  return new Date(safeIsoDate(value)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TripChatPanel({
  tripId,
  label,
  disabled = false,
  disabledReason = "Chat is available after the driver accepts the trip.",
  buttonClassName,
  initialOpen = false,
}: Props) {
  const [open, setOpen] = useState(initialOpen && !disabled);
  const [messages, setMessages] = useState<TripMessage[]>([]);
  const [role, setRole] = useState<TripChatRole | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastUnreadCountRef = useRef(0);
  const mountedRef = useRef(false);

  const remaining = MAX_MESSAGE_LENGTH - text.length;

  const sortedMessages = useMemo(() => {
    return [...messages].sort(
      (a, b) => safeDateMs(a.created_at) - safeDateMs(b.created_at),
    );
  }, [messages]);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? "";
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadMessages = useCallback(
    async (showLoading = true) => {
      if (!open) return;

      if (!tripId) {
        setError("Unable to load this trip chat. Please reopen the trip.");
        return;
      }

      if (showLoading) setLoading(true);
      setError(null);

      try {
        const token = await getAccessToken();
        if (!token) {
          if (mountedRef.current) {
            setError("Please log in again to use chat.");
            setLoading(false);
          }
          return;
        }

        const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/messages?markRead=1`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const json = (await res.json().catch(() => null)) as MessagesResponse | null;

        if (!res.ok || !json?.ok) {
          if (mountedRef.current) {
            setError(json?.error || "Unable to load messages. Try again.");
            setLoading(false);
          }
          return;
        }

        if (!mountedRef.current) return;
        setMessages(normalizeMessages(json.messages));
        setRole(json.role ?? null);
        setCanSend(Boolean(json.canSend));
        setUnreadCount(0);
      } catch (loadError: unknown) {
        console.error("[trip-chat] load failed", loadError);
        if (mountedRef.current) setError("Unable to load messages. Try again.");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [getAccessToken, open, tripId],
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadMessages();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadMessages, open]);

  useEffect(() => {
    if (!open) return;

    const channel = supabaseClient
      .channel(`trip-chat-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trip_messages",
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          void loadMessages(false);
        },
      )
      .subscribe();

    const timer = window.setInterval(() => {
      void loadMessages(false);
    }, 5000);

    return () => {
      window.clearInterval(timer);
      void supabaseClient.removeChannel(channel);
    };
  }, [loadMessages, open, tripId]);

  const loadUnreadCount = useCallback(async () => {
    if (open || disabled) return;

    try {
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/messages`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = (await res.json().catch(() => null)) as MessagesResponse | null;
      if (!res.ok || !json?.ok) return;

      const nextUnreadCount = Number(json.unreadCount ?? 0);
      if (Number.isFinite(nextUnreadCount) && nextUnreadCount > lastUnreadCountRef.current) {
        const otherParticipant = label.toLowerCase().includes("customer") ? "customer" : "driver";
        notifyInApp({
          title: `New message from ${otherParticipant}`,
          body: "Open trip chat to reply.",
          tone: "message",
          loud: true,
        });
      }

      lastUnreadCountRef.current = Number.isFinite(nextUnreadCount) ? nextUnreadCount : 0;
      setUnreadCount(Number.isFinite(nextUnreadCount) ? nextUnreadCount : 0);
    } catch (unreadError: unknown) {
      console.warn("[trip-chat] unread count failed", unreadError);
    }
  }, [disabled, getAccessToken, label, open, tripId]);

  useEffect(() => {
    if (open || disabled) return;

    const timer = window.setTimeout(() => {
      void loadUnreadCount();
    }, 0);

    const interval = window.setInterval(() => {
      void loadUnreadCount();
    }, 7000);

    const channel = supabaseClient
      .channel(`trip-chat-badge-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trip_messages",
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          void loadUnreadCount();
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      void supabaseClient.removeChannel(channel);
    };
  }, [disabled, loadUnreadCount, open, tripId]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, sortedMessages.length]);

  async function sendMessage() {
    const body = text.trim();
    if (!body || !canSend || sending) return;
    if (!tripId) {
      setError("Unable to send this message because the trip could not be found.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setError("Please log in again to send a message.");
        return;
      }

      const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body }),
      });

      const json = (await res.json().catch(() => null)) as SendResponse | null;

      if (!res.ok || !json?.ok || !json.message) {
        setError(json?.error || SEND_FAILURE_MESSAGE);
        return;
      }

      const nextMessage = sanitizeMessage(json.message);
      if (!nextMessage) {
        setError("Message was sent, but the app could not display it. Reopen chat to refresh.");
        void loadMessages(false);
        return;
      }

      if (!mountedRef.current) return;
      setText("");
      setMessages((current) => {
        if (current.some((message) => message.id === nextMessage.id)) return current;
        return [...current, nextMessage];
      });
    } catch (sendError: unknown) {
      console.error("[trip-chat] send failed", sendError);
      if (mountedRef.current) setError(SEND_FAILURE_MESSAGE);
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName ?? "moovu-btn moovu-btn-secondary"}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => setOpen(true)}
      >
        <span className="relative inline-flex items-center gap-2">
          <span>{label}</span>
          {unreadCount > 0 && (
            <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-black leading-none text-white">
              {unreadCount}
            </span>
          )}
        </span>
      </button>

      {open && (
        <TripChatErrorBoundary
          onClose={() => setOpen(false)}
          onRetry={() => {
            setMessages([]);
            setError(null);
            void loadMessages();
          }}
        >
          <div className="fixed inset-0 z-[10000] bg-slate-950/45 backdrop-blur-sm">
          <div className="flex min-h-[100dvh] items-end justify-center p-0 sm:items-center sm:p-5">
            <section className="moovu-chat-sheet flex w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
              <header className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                      MOOVU chat
                    </div>
                    <h2 className="mt-1 text-xl font-black text-slate-950">{label}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Messages are linked to this trip only.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
                    onClick={() => setOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </header>

              <div ref={listRef} className="min-h-[280px] flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
                {loading ? (
                  <div className="rounded-2xl bg-white p-4 text-sm text-slate-600">
                    Loading messages...
                  </div>
                ) : sortedMessages.length === 0 ? (
                  <div className="rounded-2xl bg-white p-4 text-sm text-slate-600">
                    No messages yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sortedMessages.map((message) => {
                      const mine = role != null && message.sender_role === role;

                      return (
                        <div
                          key={`${message.id}-${message.created_at}`}
                          className={`flex ${mine ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                              mine
                                ? "bg-[var(--moovu-primary)] text-white"
                                : "bg-white text-slate-900"
                            }`}
                          >
                            <div className="whitespace-pre-wrap break-words">{message.body}</div>
                            <div className={`mt-2 text-[11px] ${mine ? "text-white/75" : "text-slate-500"}`}>
                              {message.sender_role === "driver" ? "Driver" : "Customer"} - {formatMessageTime(message.created_at)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <footer className="border-t border-slate-200 bg-white px-4 py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
                {error && (
                  <div className="mb-3 rounded-2xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                {!canSend && (
                  <div className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                    Chat is read-only for this trip status.
                  </div>
                )}

                <div className="flex gap-2">
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    disabled={!canSend || sending}
                    rows={1}
                    placeholder={canSend ? "Type a message..." : "Chat is read-only"}
                    className="moovu-input min-h-12 resize-none"
                    aria-label="Trip chat message"
                  />
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-primary min-w-20"
                    disabled={!canSend || sending || !text.trim()}
                    onClick={() => void sendMessage()}
                  >
                    {sending ? "..." : "Send"}
                  </button>
                </div>

                <div className="mt-2 text-right text-xs text-slate-500">
                  {remaining} characters left
                </div>
              </footer>
            </section>
          </div>
        </div>
        </TripChatErrorBoundary>
      )}
    </>
  );
}
