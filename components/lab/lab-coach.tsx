"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Lightbulb, Square, Settings2 } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import type { LabCoachAction, LabItem, LabSession } from "@/src/core";
import styles from "./lab.module.css";

export function LabCoach({ session, item, busy, canCancel, streaming, status, error, onAsk, onCancel, onSettings }: {
	session: LabSession; item: LabItem; busy: boolean; streaming: string; status: string; error: string;
	canCancel: boolean;
	onAsk: (action: LabCoachAction, message?: string) => Promise<void>; onCancel: () => void; onSettings: () => void;
}) {
	const [message, setMessage] = useState("");
	const bottom = useRef<HTMLDivElement>(null);
	useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [streaming, session.messages.length]);
	const submit = async () => { const text = message.trim(); if (!text || busy) return; setMessage(""); await onAsk("ask", text); };
	return <aside className={styles.coach} aria-label="Lab coach">
		<div className={styles.paneHeader}><h2>Coach</h2><button className={styles.iconButton} aria-label="Coach model settings" onClick={onSettings}><Settings2 size={15} /></button></div>
		<div className={styles.coachMessages} aria-live="polite" aria-relevant="additions text">
			{!session.messages.length && !streaming && <div className={styles.coachEmpty}><Lightbulb size={19} /><h3>Keep the thinking yours.</h3><p>Ask for a hint, test your explanation, or review an attempt. Your coach sees this activity and your saved work.</p><p className={styles.subtle}>Uses your existing AI settings. Local mode stays local.</p></div>}
			{session.messages.map(message => <div key={message.id} className={message.role === "user" ? styles.userMessage : styles.coachMessage}><span>{message.role === "user" ? "You" : "Coach"}</span><MessageResponse>{message.content}</MessageResponse></div>)}
			{streaming && <div className={styles.coachMessage}><span>Coach</span><MessageResponse isAnimating>{streaming}</MessageResponse></div>}
			{busy && <div className={styles.coachStatus} role="status">{status || "Thinking..."}</div>}
			{error && <div className={styles.error} role="alert">{error}</div>}
			<div ref={bottom} />
		</div>
		<div className={styles.coachActions}><button disabled={busy || session.status === "completed"} onClick={() => void onAsk("hint")}>Hint</button><button disabled={busy || session.status === "completed"} onClick={() => void onAsk("review")}>Review attempt</button>{item.kind === "interview" && <button disabled={busy} onClick={() => void onAsk("report")}>Interview report</button>}</div>
		<form className={styles.coachComposer} onSubmit={event => { event.preventDefault(); void submit(); }}><label className={styles.srOnly} htmlFor="lab-coach-question">Ask the coach</label><textarea id="lab-coach-question" value={message} onChange={event => setMessage(event.target.value)} placeholder="Ask about this activity..." rows={3} disabled={busy} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(); } }} /><div><small>Ctrl + Enter to send</small>{canCancel ? <button type="button" className={styles.iconButton} aria-label="Stop coach" onClick={onCancel}><Square size={13} /></button> : <button className={styles.sendButton} aria-label="Send to coach" disabled={busy || !message.trim()}><ArrowUp size={16} /></button>}</div></form>
	</aside>;
}
