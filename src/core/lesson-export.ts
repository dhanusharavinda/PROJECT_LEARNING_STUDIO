import type { ChatRecord } from "./contracts/chat.ts";
import { sessionMarkdown } from "./session-markdown.ts";
import type { BlackboardPlan } from "./blackboard.ts";

/** Portable text only. It never writes into another application's vault. */
export function lessonExport(chat: Pick<ChatRecord, "title" | "messages">, boards: readonly BlackboardPlan[] = []) {
	const filename = (chat.title.normalize("NFKD").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 80) || "Lesson") + ".md";
	let markdown = sessionMarkdown(chat.messages, { title: chat.title.replace(/[\r\n]+/g, " "), anchors: false });
	if (boards.length) {
		markdown += "\n\n## Animated boards\n\nDownload each animation's MP4 from Learning Studio to attach it to your notebook. This Markdown contains the explanations, not the video files. Watching a board does not record mastery.\n\n";
		markdown += boards.map(board => `### ${board.title}\n\n${board.beats.map(beat => `**${beat.title}**\n\n${beat.caption}`).join("\n\n")}`).join("\n\n");
	}
	return { filename, markdown };
}
