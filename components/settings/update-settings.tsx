"use client";

import { useEffect, useState } from "react";
import { beforeRestart } from "@/components/update-readiness.ts";
import { Button } from "@/components/ui/button";
import { BrailleSpinner } from "@/components/braille-spinner";
import { SettingsRow, Toggle } from "./controls.tsx";

/** Observational snapshot from electron/main.cjs; never updater permission. */
export type UpdateState = {
	status: "idle" | "checking" | "available" | "downloading" | "up-to-date" | "downloaded" | "error" | "disabled";
	version: string | null;
	revision: number;
	progress?: number | null;
	actionError?: "download" | "busy" | "readiness" | "recovery" | "test-profile" | null;
};

export const APP_VERSION = process.env.LH_VERSION ?? "";
const HOMEPAGE = process.env.LH_HOMEPAGE ?? "";
export const MANUAL_UPDATE_HINT = "Check for a newer version, then choose Download. Updates install only when you choose Restart and install.";
export const AUTO_UPDATE_HINT = "Check at startup and every 24 hours. You choose when to download and install.";
const UPDATE_ERROR = "Couldn’t check for updates. Try again later.";

/** Subscribe before requesting the snapshot. IPC replies and pushes can
 * cross; a revision prevents an older reply from hiding a newer event.
 * The banner shares this read-only observer so late loads recover too. */
export function useUpdateState() {
	const [state, setState] = useState<UpdateState | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const lh = window.lh;
		if (!lh) return;
		let live = true;
		let revision = -1;
		const accept = (next: UpdateState) => {
			if (!live || next.revision < revision) return;
			revision = next.revision;
			setState(next);
			setFailed(false);
		};
		const off = lh.onUpdateStatus?.(accept);
		void lh.getUpdateState?.().then(accept).catch(() => {
			if (live && revision === -1) setFailed(true);
		});
		return () => { live = false; off?.(); };
	}, []);
	return { state, failed };
}

export function updateStatusText(state: UpdateState | null): string | null {
	if (state?.actionError === "recovery") return "The update did not start and the local server could not restart. Close and reopen Learning Studio.";
	if (state?.actionError === "test-profile") return "Installation is disabled in this isolated update-check profile.";
	if (state?.actionError === "busy") return "Finish or stop active lessons and renders before restarting. Your update is still ready.";
	if (state?.actionError === "readiness") return "Couldn’t confirm that it is safe to restart. Try again after active work finishes.";
	if (state?.actionError === "download") return "Couldn’t download the update. Try again.";
	switch (state?.status) {
		case "checking": return "Checking for updates…";
		case "available": return state.version ? `Version ${state.version} is available.` : "An update is available.";
		case "downloading": return `${state.version ? `Downloading version ${state.version}` : "Downloading an update"}${typeof state.progress === "number" ? ` (${state.progress}%)` : ""}…`;
		case "up-to-date": return "No newer version was found at the last check.";
		case "downloaded": return `${state.version ? `Version ${state.version}` : "An update"} is ready. Choose Restart and install when you are ready.`;
		case "error": return UPDATE_ERROR;
		default: return null;
	}
}

/** Version information is useful everywhere; update controls only belong
 * to a shell with an available updater. Opening this row never checks. */
export function UpdateSettings({
	autoUpdate,
	onAutoUpdateChange,
	version = APP_VERSION,
	homepage = HOMEPAGE,
}: {
	autoUpdate: boolean;
	onAutoUpdateChange: (on: boolean) => void;
	version?: string;
	homepage?: string;
}) {
	const { state, failed } = useUpdateState();
	const [checkFailed, setCheckFailed] = useState(false);
	const [commandBusy, setCommandBusy] = useState(false);
	const [actionFailure, setActionFailure] = useState<string | null>(null);
	useEffect(() => { setCheckFailed(false); setActionFailure(null); }, [state]);
	const active = state !== null && state.status !== "disabled";
	const busy = commandBusy || state?.status === "checking" || state?.status === "downloading";
	const status = actionFailure ?? (state?.status === "downloaded" ? updateStatusText(state)
		: failed || checkFailed ? UPDATE_ERROR : updateStatusText(state));
	const releaseNotes = version && homepage ? `${homepage}/releases/tag/v${version}` : null;
	const check = () => {
		setCheckFailed(false);
		setActionFailure(null);
		void window.lh?.checkForUpdates?.().catch(() => setCheckFailed(true));
	};
	const runAction = async (action: "downloadUpdate" | "installUpdate") => {
		setCommandBusy(true);
		setCheckFailed(false);
		setActionFailure(null);
		let release: (() => void) | undefined;
		try {
			if (action === "installUpdate") release = await beforeRestart();
			await window.lh?.[action]?.();
		}
		catch { setActionFailure(action === "installUpdate" ? "Couldn’t prepare a restart. Save your work and try again." : "Couldn’t start the download. Try again."); }
		finally { release?.(); setCommandBusy(false); }
	};

	return (
		<>
			<SettingsRow
				label={`Version ${version || "unknown"}`}
				testid="row-version"
				hint={
					<>
						{status && <span className="block" role="status" data-testid="update-status">{status}</span>}
						{active && <span className="block">{MANUAL_UPDATE_HINT}</span>}
						{releaseNotes && <a href={releaseNotes} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline" data-testid="release-notes">Release notes</a>}
					</>
				}
			>
				{active && (state.status === "downloaded" ? (
					<Button type="button" size="xs" className="cursor-pointer" data-testid="update-restart" disabled={busy} onClick={() => void runAction("installUpdate")}>Restart and install</Button>
				) : state.status === "available" ? (
					<Button type="button" size="xs" className="cursor-pointer" data-testid="update-download" disabled={busy} onClick={() => void runAction("downloadUpdate")}>Download</Button>
				) : (
					<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" data-testid="update-check" disabled={busy} aria-busy={busy} onClick={check}>
						{busy && <BrailleSpinner label={state.status === "downloading" ? "Downloading update" : "Checking for updates"} />}
						Check for updates
					</Button>
				))}
			</SettingsRow>
			{active && (
				<SettingsRow label="Check automatically" hint={AUTO_UPDATE_HINT} testid="row-auto-update">
					<Toggle checked={autoUpdate} label="auto update" onChange={onAutoUpdateChange} />
				</SettingsRow>
			)}
		</>
	);
}
