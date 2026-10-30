"use client";

/** A downloaded update waits for an explicit restart action. */

import { useState } from "react";
import { beforeRestart } from "@/components/update-readiness.ts";
import { useUpdateState, updateStatusText } from "@/components/settings/update-settings.tsx";

export default function UpdateBanner() {
	const { state: ready } = useUpdateState();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	if (ready?.status !== "downloaded") return null;
	const install = async () => {
		setBusy(true);
		setFailed(false);
		let release: (() => void) | undefined;
		try { release = await beforeRestart(); await window.lh?.installUpdate?.(); }
		catch { setFailed(true); }
		finally { release?.(); setBusy(false); }
	};
	return (
		<div
			data-testid="update-banner"
			className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg"
		>
			<div className="text-sm">
				<span className="font-medium">Learning Studio {ready.version ?? "update"} is ready</span>
				<span className="block text-muted-foreground" role="status">{failed ? "Couldn’t prepare a restart. Save your work and try again." : ready.actionError ? updateStatusText(ready) : "Restart when you are ready to install."}</span>
			</div>
			<button
				type="button"
				onClick={() => void install()}
				disabled={busy}
				className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent/80"
			>
				Restart and install
			</button>
		</div>
	);
}
