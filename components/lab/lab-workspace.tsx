"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, BookOpen, Check, Clock3, Code2, ExternalLink, FlaskConical, Search, Settings2 } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import type { LabItem, LabItemKind, LabLibrary, LabOverview, LabSession, LabTrackId } from "@/src/core";
import { labProgressLabel } from "@/src/core";
import { labRequest } from "./lab-client";
import { LabSessionWorkspace } from "./lab-session";
import styles from "./lab.module.css";

const kinds: { id: LabItemKind | "all"; label: string }[] = [{ id: "all", label: "All" }, { id: "lesson", label: "Lessons" }, { id: "coding", label: "Coding" }, { id: "design", label: "Design" }, { id: "interview", label: "Interviews" }];

export function LabWorkspace() {
	const [overview, setOverview] = useState<LabOverview | null>(null);
	const [selected, setSelected] = useState<LabSession | null>(null);
	const [track, setTrack] = useState<LabTrackId | "all">("all");
	const [kind, setKind] = useState<LabItemKind | "all">("all");
	const [query, setQuery] = useState("");
	const [savedOnly, setSavedOnly] = useState(false);
	const [historyMode, setHistoryMode] = useState(false);
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const [timerMinutes, setTimerMinutes] = useState(30);
	const settings = useSettingsDialog();
	const refresh = useCallback(async () => {
		try { setOverview(await labRequest<LabOverview>("/api/lab")); setError(""); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "The library could not be loaded."); }
	}, []);
	useEffect(() => {
		let live = true;
		void (async () => {
			try {
				const data = await labRequest<LabOverview>("/api/lab");
				if (!live) return;
				setOverview(data);
				const id = new URLSearchParams(window.location.search).get("session");
				if (id) {
					const { session } = await labRequest<{ session: LabSession }>(`/api/lab/sessions/${encodeURIComponent(id)}`);
					if (live) setSelected(session);
				}
			} catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "The library could not be loaded."); }
		})();
		return () => { live = false; };
	}, []);
	const openSession = (session: LabSession) => {
		setSelected(session);
		window.history.replaceState(null, "", `/lab?session=${encodeURIComponent(session.id)}`);
	};
	const start = async (item: LabItem, fresh = false) => {
		setBusy(item.id); setError("");
		try {
			const existing = !fresh && overview?.sessions.find(session => session.itemId === item.id && session.status === "active");
			const { session } = existing ? await labRequest<{ session: LabSession }>(`/api/lab/sessions/${existing.id}`)
				: await labRequest<{ session: LabSession }>("/api/lab/sessions", { method: "POST", body: JSON.stringify({ itemId: item.id, ...(item.kind === "interview" ? { timerMinutes } : {}) }) });
			openSession(session);
		} catch (cause) { setError(cause instanceof Error ? cause.message : "This exercise could not be opened."); }
		finally { setBusy(""); }
	};
	const bookmark = async (id: string) => {
		if (!overview) return;
		try {
			const { library } = await labRequest<{ library: LabLibrary }>("/api/lab/library", { method: "POST", body: JSON.stringify({ bookmarkId: id, bookmarked: !overview.library.bookmarks.includes(id) }) });
			setOverview(current => current ? { ...current, library } : current);
		} catch (cause) { setError(cause instanceof Error ? cause.message : "The bookmark could not be saved."); }
	};
	const items = useMemo(() => overview?.catalog.items.filter(item => (track === "all" || item.trackId === track) && (kind === "all" || item.kind === kind) && (!savedOnly || overview.library.bookmarks.includes(item.id)) && `${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.order - b.order) ?? [], [overview, track, kind, savedOnly, query]);
	const selectedItem = overview?.catalog.items.find(item => item.id === selected?.itemId);
	const savedResources = useMemo(() => Array.from(new Map(overview?.catalog.items.flatMap(item => item.resources.filter(resource => overview.library.bookmarks.includes(resource.id)).map(resource => [resource.id, resource] as const))).values()), [overview]);
	const previousSessions = overview?.sessions.filter(session => session.title.toLowerCase().includes(query.toLowerCase())) ?? [];
	const back = async () => { setSelected(null); window.history.replaceState(null, "", "/lab"); await refresh(); };
	if (selected && selectedItem && overview) return <LabSessionWorkspace key={selected.id} initial={selected} item={selectedItem} catalog={overview.catalog} library={overview.library} onBack={back} onBookmark={bookmark} onOpenItem={item => void start(item)} />;
	return <main className={styles.lab} data-testid="lab-catalog">
		<header className={`${styles.header} lh-drag lh-header-gutter`}>
			<div className={styles.titleRow}><SidebarToggle /><FlaskConical size={18} aria-hidden="true" /><h1>Experimental Lab</h1></div>
			<button className={`${styles.iconButton} lh-no-drag`} aria-label="AI settings" title="AI settings" onClick={() => settings.open("agent")}><Settings2 size={17} /></button>
		</header>
		<div className={styles.catalogLayout}>
			<nav className={styles.tracks} aria-label="Study tracks">
				<button className={track === "all" && !historyMode ? styles.activeTrack : ""} onClick={() => { setTrack("all"); setHistoryMode(false); }}><BookOpen size={16} />All tracks</button>
				{overview?.catalog.tracks.map(value => <button key={value.id} className={track === value.id && !historyMode ? styles.activeTrack : ""} onClick={() => { setTrack(value.id); setHistoryMode(false); }}>{value.title}</button>)}
				<div className={styles.trackDivider} />
				<button aria-pressed={savedOnly && !historyMode} className={savedOnly && !historyMode ? styles.activeTrack : ""} onClick={() => { setSavedOnly(!savedOnly); setHistoryMode(false); }}><Bookmark size={15} />Saved</button>
				<button aria-pressed={historyMode} className={historyMode ? styles.activeTrack : ""} onClick={() => { setHistoryMode(true); setSavedOnly(false); }}><Clock3 size={15} />History</button>
				<div className={styles.trackNote}>Reading is a start.<br />Practice leaves evidence.</div>
			</nav>
			<section className={styles.catalogBody}>
				<div className={styles.catalogIntro}>
					<div><h2>{historyMode ? "Your study history" : track === "all" ? "Build understanding by doing." : overview?.catalog.tracks.find(value => value.id === track)?.title}</h2><p>{historyMode ? "Revisit an attempt, its feedback, and what you learned." : track === "all" ? "Learn a concept, work through a problem, then test your reasoning." : overview?.catalog.tracks.find(value => value.id === track)?.description}</p></div>
				</div>
				{error && <div className={styles.error} role="alert">{error}<button onClick={() => void refresh()}>Retry</button></div>}
				{overview && !query && !savedOnly && overview.sessions.some(session => session.status === "active") && <section className={styles.resume} aria-label="Continue studying"><span>Continue</span>{overview.sessions.filter(session => session.status === "active").slice(0, 2).map(session => <button key={session.id} onClick={() => { setBusy(session.id); void labRequest<{ session: LabSession }>(`/api/lab/sessions/${session.id}`).then(result => openSession(result.session)).catch(cause => setError(String(cause.message))).finally(() => setBusy("")); }} disabled={!!busy}>{session.title}<ArrowUpRight size={15} /></button>)}</section>}
				<div className={styles.filters}>
					<div className={styles.search}><Search size={15} /><input aria-label="Search the Lab" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search topics, skills, concepts" /></div>
					{!historyMode && <div className={styles.kindTabs} aria-label="Exercise type">{kinds.map(value => <button key={value.id} aria-pressed={kind === value.id} onClick={() => setKind(value.id)}>{value.label}</button>)}</div>}
				</div>
				{kind === "interview" && <label className={styles.timerSetup}><Clock3 size={15} />Interview timer<select value={timerMinutes} onChange={event => setTimerMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></label>}
				{savedOnly && !!savedResources.length && <section className={styles.resourceList} aria-label="Saved references">{savedResources.map(resource => <article key={resource.id}><div><h3><a href={resource.url} target="_blank" rel="noreferrer">{resource.title}<ExternalLink size={13} /></a></h3><p>{resource.description}</p></div><button className={styles.iconButton} aria-label={`Unsave ${resource.title}`} onClick={() => void bookmark(resource.id)}><Bookmark size={15} fill="currentColor" /></button></article>)}</section>}
				<div className={styles.listHeading}><span>{historyMode ? `${previousSessions.length} sessions` : `${items.length} ${items.length === 1 ? "activity" : "activities"}`}</span><span>{historyMode ? "State · Date" : "Level · Time"}</span></div>
				{historyMode ? <div>{!previousSessions.length && <div className={styles.empty}>Your study sessions will appear here.</div>}{previousSessions.map(session => <article className={styles.itemRow} key={session.id}><button className={styles.itemOpen} disabled={!!busy} onClick={() => { setBusy(session.id); void labRequest<{ session: LabSession }>(`/api/lab/sessions/${session.id}`).then(result => openSession(result.session)).catch(cause => setError(String(cause.message))).finally(() => setBusy("")); }}><span className={styles.itemIdentity}><span className={styles.itemTitle}>{session.title}</span><span className={styles.itemMeta}>{session.kind} · {session.stage}</span></span><span className={styles.itemStats}>{session.status === "completed" ? "Completed" : "In progress"}<small>{new Date(session.updatedAt).toLocaleDateString()}</small></span></button></article>)}</div> : !overview && !error ? <div className={styles.empty} role="status">Loading your study library...</div> : !items.length ? <div className={styles.empty}>No activities match this view.<button onClick={() => { setQuery(""); setKind("all"); setSavedOnly(false); }}>Clear filters</button></div> : <div className={styles.itemList}>{items.map(item => {
					const progress = overview?.library.progress[item.id];
					const isSaved = overview?.library.bookmarks.includes(item.id);
					return <article className={styles.itemRow} key={item.id}>
						<button className={styles.itemOpen} onClick={() => void start(item)} disabled={!!busy}>
							<span className={styles.itemIdentity}><span className={styles.itemTitle}>{item.coding ? <Code2 size={16} /> : <BookOpen size={16} />}{item.title}</span><span className={styles.itemSummary}>{item.summary}</span><span className={styles.itemMeta}>{item.kind}{progress && <span className={progress.state === "proven" ? styles.verified : ""}>{progress.state === "proven" && <Check size={12} />}{labProgressLabel[progress.state]}</span>}</span></span>
							<span className={styles.itemStats}>{item.difficulty}<small>{item.minutes} min</small></span>
						</button>
						<button className={styles.iconButton} aria-label={`${isSaved ? "Unsave" : "Save"} ${item.title}`} aria-pressed={isSaved} onClick={() => void bookmark(item.id)}><Bookmark size={15} fill={isSaved ? "currentColor" : "none"} /></button>
					</article>;
				})}</div>}
				<footer className={styles.catalogFooter}><span>Original exercises · Progress stays on this device</span><button onClick={() => window.location.assign("/")}><ArrowLeft size={13} />Knowledge graph</button></footer>
			</section>
		</div>
	</main>;
}
