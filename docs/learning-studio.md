# Learning Studio: LearnHarness with a ManimGX blackboard

Learning Studio is a separate Windows desktop application. LearnHarness remains the teacher, question engine, practice system, and lesson history. ManimGX is integrated into its background-job system and displays rendered lessons inside the conversation. Synapse is not modified and keeps its own files and settings.

## First use

Run `dist/Learning Studio-0.4.0-studio.1-x64-setup.exe` from this project to install the application. The installer lets you choose a location and includes its own Python renderer. A separate system Python installation is not required.

Open Learning Studio. Start a lesson and its setup dialog opens if models are not configured. DeepSeek is preselected as the initial provider. Paste a key into the password field, save it, choose **Use recommended**, and then **Save models**. This configures DeepSeek Flash for teaching, workhorse tasks, and visual checks with low reasoning effort where supported. Saving setup does not send a lesson or start a model request. DeepSeek Pro remains selectable for difficult lessons. Keys are stored locally through LearnHarness's existing auth store, never compiled into the installer or returned as plaintext through the settings API.

The user chose to create their API key later. Until then, expand **Preview the animated blackboard** in setup to play a pre-rendered RAG example without a provider call. The sample is clearly labeled and does not impersonate a live AI conversation. To create a key later, use the official DeepSeek platform, then enter it in the application rather than in a chat or screenshot.

## A RAG lesson

Ask: **Explain RAG. Check whether I understand embeddings first, then animate indexing separately from retrieval and answering.**

The teacher first establishes prerequisites, explains the concept, and can request an `animation` job while continuing the lesson. Its structured plan contains the actual concept labels, connections, captions, and teaching beats. ManimGX inspects the layout and renders it locally. The resulting card provides standard playback, chapter jumps, MP4 download, and **Check my understanding**. A failed render reports the failure and offers **Ask teacher to retry**. The activity dock supports canceling background work. Identical successful scene plans reuse validated saved media.

RAG indexing should show documents, chunks, embeddings, and an index. Query-time explanation should distinguish the question, retrieval of evidence, and an answer grounded in that evidence. The teacher should then ask about retrieval errors and require a numerical, explanatory, or coding task. Watching a video does not establish mastery.

## Blackboard vocabulary

The first integrated tool supports multi-beat flows, two-dimensional vectors with computed cosine similarity, gradient descent on a specified quadratic, and text explanation boards. Plans are bounded to eight beats and sixty seconds. Flow references and numeric bounds are checked before rendering. The compiler generates fixed Python from validated data; the model does not receive arbitrary Python or shell execution. This integration does not expose every ManimGX API or promise arbitrary three-dimensional simulations.

The app retains existing interactive HTML demos and SVG figures. A slider-driven experiment can use a demo, a static spatial figure can use SVG, and an ordered animated explanation can use ManimGX. An animation is not required for every answer.

## Save material into Synapse

Use **Save lesson as Markdown** in the lesson's top bar. It exports readable teacher and learner text, plus the captions of completed animated boards. Download an animation's MP4 separately from its card if you want to attach it to your notebook. Markdown export explicitly identifies separate media and does not contain broken private API links. Neither app silently edits the other's notes or graph. Import selected note files into LearnHarness using its existing notes-import workflow. Specialized Synapse canvas markup may require a clean text export before importing.

## Cost and privacy

Teaching and other model calls use the provider selected in settings. ManimGX rendering is local and makes no paid model request of its own. The animation plan is authored in the teacher's existing response, avoiding a separate model call for generating scene code. There is no automatic cloud voice generation. Existing provider usage displays are estimates, not a hard dollar billing limit. Use provider account controls for spending limits. A local model endpoint remains available, but models labeled `cloud` are remote even when accessed through Ollama.

The standalone installer includes the renderer and portable Python. It does not require a machine-wide Python installation. The application has a distinct Windows identity and user-data folder. Upstream LearnHarness automatic updates are disabled for this fork, preventing replacement with a build that lacks the blackboard integration. No public release feed has been configured for Learning Studio.

## Development and validation

- `npm ci`: install Node dependencies.
- `powershell -ExecutionPolicy Bypass -File scripts/setup-manimgx.ps1`: prepare the project-local portable runtime from official Python and PyPI packages.
- `npm test`, `npm run typecheck`, `npm run lint`: deterministic gates.
- `npm run desktop:win`: build, curate standalone output, smoke-test with Electron's Node runtime, and create a Windows installer.
- `npm run desktop:pack`: package an already prepared standalone build.

Use project-local `work/` directories for synthetic test data. Never use a personal notebook for automated tests. The real native smoke receipts distinguish scripted provider transport tests from live model inference. Live DeepSeek quality and latency remain unverified until a key is supplied.

## Attribution and licenses

This application extends [LearnHarness](https://github.com/amosblomqvist/learnharness), licensed AGPL-3.0-only. The original author and license remain in the repository. [ManimGX](https://github.com/academa-labs/manimgx) supplies the animation engine. Its own code is MIT; its native wheels are GPL-3.0-or-later as a whole. The portable runtime retains bundled license notices. This is a local build, not a proprietary license exception or a published official LearnHarness release.
