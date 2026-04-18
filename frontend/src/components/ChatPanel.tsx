import { useState, useEffect, useRef, useCallback } from "react";
import {
  createConversation, getConversation, sendChatMessage,
  deleteConversation,
} from "../api";
import type { ChatMessage, ConversationMeta } from "../types";

interface Props {
  videoId: string;
  analysisId?: string;
  conversations: ConversationMeta[];
  onReanalysisTriggered: (analysisId: string) => void;
  onConversationsChanged: () => void;
}

export function ChatPanel({
  videoId, analysisId, conversations, onReanalysisTriggered, onConversationsChanged,
}: Props) {
  const [activeConvId, setActiveConvId] = useState<string | null>(
    conversations[0]?.conv_id ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversation = useCallback(async (convId: string) => {
    try {
      const conv = await getConversation(videoId, convId);
      setMessages(conv.messages);
    } catch {
      setMessages([]);
    }
  }, [videoId]);

  useEffect(() => {
    if (activeConvId) loadConversation(activeConvId);
    else setMessages([]);
  }, [activeConvId, loadConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startNewConversation = useCallback(async () => {
    const { conv_id } = await createConversation(videoId);
    setActiveConvId(conv_id);
    setMessages([]);
    onConversationsChanged();
  }, [videoId, onConversationsChanged]);

  const handleDeleteConversation = useCallback(async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    await deleteConversation(videoId, convId);
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
    onConversationsChanged();
  }, [videoId, activeConvId, onConversationsChanged]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    let convId = activeConvId;

    if (!convId) {
      const { conv_id } = await createConversation(videoId);
      convId = conv_id;
      setActiveConvId(conv_id);
      onConversationsChanged();
    }

    const userMsg: ChatMessage = { role: "user", content: input.trim(), ts: Date.now() / 1000 };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const resp = await sendChatMessage(videoId, convId, userMsg.content, analysisId);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: resp.reply,
        ts: Date.now() / 1000,
        action: resp.action,
      };
      setMessages(prev => [...prev, assistantMsg]);
      onConversationsChanged();

      if (resp.triggered_analysis_id) {
        onReanalysisTriggered(resp.triggered_analysis_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  }, [input, sending, activeConvId, videoId, analysisId, onReanalysisTriggered, onConversationsChanged]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Conversation tabs */}
      <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
        <button
          onClick={startNewConversation}
          className="flex-shrink-0 px-3 py-1.5 text-xs bg-pitch-700 hover:bg-pitch-500 text-white rounded-lg transition-colors touch-manipulation"
        >
          + New chat
        </button>
        {conversations.map(c => (
          <div key={c.conv_id} className="flex-shrink-0 flex items-center gap-1">
            <button
              onClick={() => setActiveConvId(c.conv_id)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors max-w-32 truncate touch-manipulation
                ${activeConvId === c.conv_id
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
              title={c.title}
            >
              {c.title}
            </button>
            <button
              onClick={(e) => handleDeleteConversation(c.conv_id, e)}
              className="text-gray-400 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 text-xs w-5 h-5 flex items-center justify-center touch-manipulation"
              title="Delete"
            >×</button>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-600 text-sm pt-8">
            <p>Ask about the technique, correct the shot type,</p>
            <p>or say "re-analyse" to run a new analysis.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap
              ${msg.role === "user"
                ? "bg-pitch-700 text-white rounded-br-sm"
                : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-sm"}`}
            >
              {msg.content}
              {msg.action === "reanalyze" && (
                <p className="text-xs text-pitch-400 mt-1 font-medium">⟳ Re-analysis triggered</p>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-3 py-2">
              <span className="text-gray-500 dark:text-gray-400 text-sm animate-pulse">Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 mb-1 px-1">{error}</p>
      )}

      {/* Input */}
      <div className="flex gap-2 mt-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about the technique…"
          rows={1}
          className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:outline-none focus:border-pitch-500 transition-colors"
          style={{ maxHeight: "96px", overflowY: "auto" }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="px-4 py-2 bg-pitch-700 hover:bg-pitch-500 disabled:opacity-40 rounded-xl text-sm text-white transition-colors touch-manipulation self-end"
        >
          Send
        </button>
      </div>
    </div>
  );
}
