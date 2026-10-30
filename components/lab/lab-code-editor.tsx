"use client";

import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import styles from "./lab.module.css";

const theme = EditorView.theme({
	"&": { backgroundColor: "var(--background)", color: "var(--foreground)", height: "100%", fontSize: "13px" },
	".cm-content": { fontFamily: "var(--font-jetbrains), monospace", caretColor: "var(--foreground)", padding: "14px 0" },
	".cm-scroller": { fontFamily: "var(--font-jetbrains), monospace", overflow: "auto" },
	".cm-gutters": { backgroundColor: "var(--background)", color: "#949494", borderRight: "1px solid #2b2b2b" },
	".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "#1c1c1c" },
	"&.cm-focused": { outline: "none" },
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#3d4650" },
}, { dark: true });

export default function LabCodeEditor({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
	return <div className={styles.codeEditor} data-testid="lab-code-editor"><CodeMirror aria-label="Python code" value={value} onChange={onChange} extensions={[python(), syntaxHighlighting(oneDarkHighlightStyle)]} theme={theme} editable={!disabled} height="100%" minHeight="280px" basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true, tabSize: 4 }} /></div>;
}
