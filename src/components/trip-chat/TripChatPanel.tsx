"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

const MAX_MESSAGE_LENGTH = 1000;

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TripChatPanel({
  tripId,
  label,
  disabled = false,
  disabledReason = "Chat is available after the driver accepts the trip.",
}: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<TripMessage[]>([]);
  const [role, setRole] = useState<TripChatRole | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const remaining = MAX_MESSAGE_LENGTH - text.length;

  const sortedMessages = useMemo(() => {
    return [...messages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messages]);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? "";
  }, []);

  const loadMessages = useCallback(
    async (showLoading = true) => {
      if (!open) return;

      if (showLoading) setLoading(true);
      setError(null);

      const token = await getAccessToken();
      if (!token) {
        setError("Please log in again to use chat.");
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/messages`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = (await res.json().catch(() => null)) as MessagesResponse | null;

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Could not load chat messages.");
        setLoading(false);
        return;
      }

      setMessages(json.messages ?? []);
      setRole(json.role ?? null);
      setCanSend(Boolean(json.canSend));
      setLoading(false);
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

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, sortedMessages.length]);

  async function sendMessage() {
    const body = text.trim();
    if (!body || !canSend) return;

    setSending(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError("Please log in again to send a message.");
      setSending(false);
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
    setSending(false);

    if (!res.ok || !json?.ok || !json.message) {
      setError(json?.error || "Could not send message.");
      return;
    }

    setText("");
    setMessages((current) => {
      if (current.some((message) => message.id === json.message?.id)) return current;
      return [...current, json.message as TripMessage];
    });
  }

  return (
    <>
      <button
        type="button"
        className="moovu-btn moovu-btn-secondary"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[10000] bg-slate-950/45 backdrop-blur-sm">
          <div className="flex min-h-[100dvh] items-end justify-center p-0 sm:items-center sm:p-5">
            <section className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
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
                          key={message.id}
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
      )}
    </>
  );
}
