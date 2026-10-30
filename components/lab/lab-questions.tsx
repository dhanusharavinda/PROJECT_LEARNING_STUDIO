"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { LabItem, LabSession } from "@/src/core";
import type { LabDraft } from "./lab-client";
import styles from "./lab.module.css";

export function LabQuestions({ item, session, edit, disabled, onInterview }: { item: LabItem; session: LabSession; edit: (patch: LabDraft) => void; disabled: boolean; onInterview: (questionId: string) => void }) {
	const [revealed, setRevealed] = useState<Record<string, boolean>>({});
	const questions = item.kind === "interview" ? item.questions.slice(session.questionIndex, session.questionIndex + 1) : item.questions;
	return <section className={styles.questions} aria-label="Knowledge checks">
		<div className={styles.sectionTitle}><h3>{item.kind === "interview" ? "Interview" : "Check your understanding"}</h3>{item.kind === "interview" && <div className={styles.inlineActions}><button className={styles.iconButton} aria-label="Previous question" disabled={disabled || session.questionIndex === 0} onClick={() => edit({ questionIndex: session.questionIndex - 1 })}><ChevronLeft size={16} /></button><span>{session.questionIndex + 1} / {item.questions.length}</span><button className={styles.iconButton} aria-label="Next question" disabled={disabled || session.questionIndex >= item.questions.length - 1} onClick={() => edit({ questionIndex: session.questionIndex + 1 })}><ChevronRight size={16} /></button></div>}</div>
		{questions.map((question, index) => <fieldset key={question.id} className={styles.question} disabled={disabled}>
			<legend>{item.kind !== "interview" && <span>{index + 1}. </span>}{question.prompt}</legend>
			{question.options ? <div className={styles.quizOptions}>{question.options.map((option, choice) => <label key={choice}><input type="radio" name={`question-${question.id}`} checked={session.quizAnswers[question.id] === choice} onChange={() => { edit({ quizAnswers: { ...session.quizAnswers, [question.id]: choice } }); setRevealed(current => ({ ...current, [question.id]: false })); }} /><span>{option}</span></label>)}</div> : null}
			<label className={styles.fieldLabel} htmlFor={`answer-${question.id}`}>{question.options ? "Why did you choose that answer?" : "Your answer"}</label>
			<textarea id={`answer-${question.id}`} value={session.answers[question.id] ?? ""} onChange={event => edit({ answers: { ...session.answers, [question.id]: event.target.value } })} rows={item.kind === "interview" ? 8 : 4} placeholder="Explain the reasoning, tradeoffs, and an example." />
			<div className={styles.inlineActions}>{question.options ? <button disabled={session.quizAnswers[question.id] === undefined} onClick={() => setRevealed(current => ({ ...current, [question.id]: true }))}>Check answer</button> : <button onClick={() => onInterview(question.id)}>Review this answer</button>}</div>
			{revealed[question.id] && <div className={styles.answerReveal}><strong>{session.quizAnswers[question.id] === question.answer ? <><Check size={15} />Correct</> : "Try the explanation, then revisit your choice."}</strong><p>{question.explanation}</p></div>}
		</fieldset>)}
	</section>;
}
