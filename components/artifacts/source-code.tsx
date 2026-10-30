"use client";

import { useState } from "react";
import { Check, Code2, Copy } from "lucide-react";

export function SourceCode({ code, language, note }: { code: string; language: "HTML" | "Python"; note?: string }) {
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState("");
	async function copy() {
		try { await navigator.clipboard.writeText(code); setCopied(true); setError(""); }
		catch { setError("Select the code to copy it."); }
	}
	return <details className="border-t border-border/70 font-ui text-xs" data-testid="visual-source-code">
		<summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Code2 className="size-3.5" aria-hidden="true" />View code</summary>
		<div className="border-t border-border/60">
			<div className="flex items-center justify-between gap-3 px-3 py-2"><span className="text-muted-foreground">{language}</span><button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2">{copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}{copied ? "Copied" : "Copy code"}</button></div>
			{note && <p className="px-3 pb-2 text-muted-foreground">{note}</p>}
			{error && <p role="status" className="px-3 pb-2 text-muted-foreground">{error}</p>}
			<pre className="max-h-80 overflow-auto bg-muted/40 px-3 py-3 text-xs leading-relaxed [tab-size:2]"><code>{code}</code></pre>
		</div>
	</details>;
}
