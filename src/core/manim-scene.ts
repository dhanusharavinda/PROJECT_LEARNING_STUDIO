import type { BlackboardArtifact } from "./blackboard.ts";

export interface ManimSceneArtifact extends BlackboardArtifact {
	sourceCode: string;
	reviewNotes?: string;
	verification: {
		boundary: "restricted-scene-interpreter";
		mathAssertions: number;
		layoutChecked: boolean;
		threeD: boolean;
		visualReviewed: boolean;
		reviewModel?: string;
		reviewCoverage?: { sampledFrames: number; sectionCount: number; coveredSections: number };
	};
}
