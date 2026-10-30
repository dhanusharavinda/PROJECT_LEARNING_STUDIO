# Learning Studio: LearnHarness with a ManimGX blackboard

Learning Studio is a separate Windows desktop application. LearnHarness remains the teacher, question engine, practice system, and lesson history. ManimGX is integrated into its background-job system and displays rendered lessons inside the conversation. Synapse is not modified and keeps its own files and settings.

## First use

Download the installer from [Learning Studio releases](https://github.com/dhanusharavinda/PROJECT_LEARNING_STUDIO/releases), or build `dist/Learning-Studio-0.5.0-x64-setup.exe` from this project. The installer lets you choose a location and includes its own Python renderer. A separate system Python installation is not required.

## Experimental Lab

The Lab adds original study paths in algorithms, AI engineering, electronics and system design. Its catalog supports filtering, bookmarks, references and saved attempts. An exercise opens in a compact workspace with the material, your working area and an optional coach. The stages are Understand, Plan, Attempt, Test and Reflect. Your explanation and reflection are saved alongside code, answers, hints and test history. Saved material, reading, practice and verified exercise checks remain distinct.

Python exercises run in a disposable browser worker using the bundled Pyodide interpreter. They do not run on the host Python interpreter. The sandbox has an opaque origin, blocked network access and no app credentials or persistent filesystem. Runtime assets load locally, with a 15-second loading limit and 30-second execution limit. Cancel terminates the worker. Standard-library exercises work offline; installing arbitrary network packages is not supported. Results are checked against the catalog on the server and tied to the exact saved code revision. This is a local learning tool, not a tamper-proof examination system.

The coach uses the existing model selection and offline setting. It can ask questions, give staged hints and review reasoning. Structured reviews retain strengths, improvements and estimated usage. AI feedback does not become evidence that code passed tests. Interview mode adds a timer and question-by-question answers. Teach and Practice handoffs carry the exercise and your current work into the existing lesson system, where interactive visuals and the knowledge graph remain available.

The study material and implementation are original to this project. INDEX 0 was a product-workflow reference. Its proprietary curriculum, prompts, source code and branding are not included. External resources link to their publishers, who retain their own licenses.

### Offline learning

In Providers, choose an installed model in **Offline model**, then turn on **Offline learning**. The same switch appears in first-use setup. Models are discovered from your local Ollama server, and cloud models are excluded. The chosen model is stored as a preference, not compiled into the app. To download the user's requested model, run `ollama pull qwen3.5:9b` once while connected to the internet. Model weights live in Ollama's storage, outside the application installer.

Offline mode routes teaching, practice, visual reading, and background model work to the local model, including sessions with older cloud overrides. A local Ollama alias configures a 32k context without changing the source model or duplicating its weights. New remote server requests are blocked, including online search and dictation. Requests already sent before switching modes cannot be recalled. Manual external links still open in the browser. Turn offline learning off to restore the saved cloud choices. No automatic paid fallback occurs if Ollama stops.

For a DeepSeek-only online setup, use Flash for everyday lessons, summaries, grading, and visual reading. Use Pro for difficult mathematical explanations, debugging, and architecture questions, retaining Flash for image input where Pro lacks vision. Model selection stays under user control.

Open Learning Studio. Start a lesson and its setup dialog opens if models are not configured. DeepSeek is preselected as the initial provider. Paste a key into the password field, save it, choose **Use recommended**, and then **Save models**. This configures DeepSeek Flash for teaching, workhorse tasks, and visual checks with low reasoning effort where supported. Saving setup does not send a lesson or start a model request. DeepSeek Pro remains selectable for difficult lessons. Keys are stored locally through LearnHarness's existing auth store, never compiled into the installer or returned as plaintext through the settings API.

The user chose to create their API key later. Until then, expand **Preview the animated blackboard** in setup to play a pre-rendered RAG example without a provider call. The sample is clearly labeled and does not impersonate a live AI conversation. To create a key later, use the official DeepSeek platform, then enter it in the application rather than in a chat or screenshot.

## Optional services in Providers

- **Deepgram** transcribes microphone speech into text for dictation. It is not the teaching model.
- **Tavily** supplies web search results for the research assistant.
- **Brave Search** is an alternative search provider. One working search provider is enough; both are optional.

These online services can remain unconfigured for offline learning. Teaching text and local images use the selected local model. Online research and dictation are paused while offline mode is on.

## Find the knowledge graph

Click the top-left logo, whose hover label is **Knowledge graph**, to open Home. In Settings, Graph, keep **Graph rendering** on to see the canvas and **Extraction** on to build learning records. A new notebook starts empty. Import notes from Home or allow the extraction workflow to process learning material. Synapse and Learning Studio have separate graphs; import chosen Markdown notes when transferring material.

## How the two engines work together

LearnHarness owns the conversation, prerequisite assessment, practice, saved lessons, and knowledge graph. A visual director reads the current lesson and chooses a live experiment, a directed animation, or a precise diagram. A specialist writes and tests the instrument. An independent reviewer checks the mathematics and actual rendered image before publication. The teacher uses the result for prediction and understanding checks. Shared instructions tell all model roles never to use em dashes in newly generated text.

`Question -> LearnHarness teacher -> Visual director -> Author and test -> Review and repair -> Inline instrument -> Understanding check`

## A RAG lesson

Explicit requests such as **Teach RAG visually** or **Build an interactive gradient descent experiment** trigger a saved visual job even if the teacher does not choose a visual tool. This works in Teaching and Practice, including while a question is waiting for an answer. A request to animate a concept should not become a Manim programming exam. It uses the lesson context and the selected strong teaching model, including offline Ollama. Automatic subscription-provider calls respect that connection's background-use preference. If those calls are disabled, make a direct manual request instead.

Each saved explanation has a compact **Generate visual** action. Its dropdown offers **Choose best visual**, **Interactive demo**, **Animation**, and **Diagram**. Progress and the finished instrument appear in the same place. Repeated clicks share a running job, and finished results remain available after reopening the lesson. Failures offer **Retry visual**. Direct requests do not wake the teacher or require completing a quiz first. Native teacher-dispatched instruments retain follow-up teaching behavior and are also visible while a quiz is pending.

The **Animations** switch in the chat header pauses saved videos and interactive motion without resetting their state. Turning it off disables new moving visuals. **Generate diagram** remains available. The preference is saved locally. No narration or paid fallback is enabled automatically.

Ask: **Explain RAG. Check whether I understand embeddings first, then animate indexing separately from retrieval and answering.**

The teacher first establishes prerequisites, explains the concept, and requests a visual job while continuing the lesson. An interactive RAG experiment can change retrieval inputs and compute the result. A directed ManimGX scene can show indexing and query-time retrieval in sequence. Animation cards provide playback, chapters, MP4 download, and **Check my understanding**. HTML and Python source are available under **View code** with a copy action. The activity dock supports cancelling background work.

RAG indexing should show documents, chunks, embeddings, and an index. Query-time explanation should distinguish the question, retrieval of evidence, and an answer grounded in that evidence. The teacher should then ask about retrieval errors and require a numerical, explanatory, or coding task. Watching a video does not establish mastery.

## Complex visuals and verification

New animation requests can author code-driven ManimGX scenes, including 2D and 3D geometry, surfaces, camera movement, equations, matrices, transforms, plots and vector fields. They are no longer confined to the original four templates. Existing saved structured boards still render through their compatible path.

Generated scene code runs in a restricted drawing and mathematics interpreter. It is not unrestricted Python and is not an operating-system sandbox. Arbitrary file, network and system access, imports, reflection and private attributes are excluded. Runtime, memory, array, loop and object limits apply. These boundaries intentionally exclude unsupported APIs that could bypass the drawing interface.

Interactive HTML uses real computed values and labeled parameter controls, with pause, single-step and reset. A browser test operates those controls inside the same opaque-origin, network-blocked sandbox used for delivery. Known numerical examples must pass. A separate model reviews the source and actual pixels, can reject incorrect formulas or clipped labels, and requests repairs. Native scenes execute mathematical assertions and receive storyboard review. Testing and model review improve reliability but do not prove every mathematical claim.

Example requests:

- **Build a 3D gradient descent experiment for f(x,y)=0.5x^2+y^2. Let me change learning rate and start coordinates. Explain convergence and divergence.**
- **Show a neural network forward pass. Let me change an input and weight and inspect the computed activations. Distinguish this toy network from a full language model.**
- **Animate a matrix transforming a grid, then let me test how its determinant changes area.**
- **Teach attention using the actual QK-transpose, scaling and softmax operations, with a small worked example.**

## Available visual formats

| Format | Best use | Example request |
| --- | --- | --- |
| Interactive HTML demo | Sliders, simulations, sampling and experiments | Build a demo where I adjust chunk size and retrieval threshold. |
| Code-driven ManimGX animation | Equations, transformations and complex 2D or 3D explanations | Show gradient descent on a 3D loss surface with a moving camera. |
| Static SVG figure | Precise plots, coordinates, geometry and vectors | Draw two vectors with their angle and projections. |
| Inline Mermaid diagram | Flows, architecture, relationships and sequences | Show a sequence diagram of a RAG request. |
| Rendered mathematics | Equations and worked calculations | Work through cosine similarity numerically. |

Reference interactive instruments are bundled at `/studio/interactive/gradient-descent-3d.html` and `/studio/interactive/neural-signal-flow.html` for inspection. New lessons are authored from their context rather than relabeled from these examples. Images and PDFs can supply lesson material, but there is no built-in generative-image service.

## Save material into Synapse

Use **Save lesson as Markdown** in the lesson's top bar. It exports readable teacher and learner text, plus the captions of completed animated boards. Download an animation's MP4 separately from its card if you want to attach it to your notebook. Markdown export explicitly identifies separate media and does not contain broken private API links. Neither app silently edits the other's notes or graph. Import selected note files into LearnHarness using its existing notes-import workflow. Specialized Synapse canvas markup may require a clean text export before importing.

## Cost and privacy

Teaching and other model calls use the providers selected in settings. The visual director, code author and independent reviewer make additional model calls and repairs can add more. Rich authoring uses the lesson's strong model; image review uses a configured image-capable model. Each call is attributed to its actual model in the usage estimate, including mixed providers. ManimGX rendering itself runs locally without a per-render service fee. There is no automatic cloud voice generation. Usage displays are estimates, not a hard billing limit. Use provider account controls for spending limits. A local endpoint remains available, but models labeled `cloud` are remote even when accessed through Ollama.

The standalone installer includes the renderer and portable Python. It does not require a machine-wide Python installation. The application has a distinct Windows identity and user-data folder. Updates come only from `dhanusharavinda/PROJECT_LEARNING_STUDIO`, not upstream LearnHarness. Settings → General offers Check, Download and Restart/install. An optional automatic check discovers versions but does not silently install on ordinary quit. Restart is refused while teaching, background rendering, extraction, compaction or Lab work is active. Installers are currently unsigned. See [the release procedure](desktop-release.md) for verification and publication.

## Development and validation

- `npm ci`: install Node dependencies.
- `powershell -ExecutionPolicy Bypass -File scripts/setup-manimgx.ps1`: prepare the project-local portable runtime from official Python and PyPI packages.
- `npm test`, `npm run typecheck`, `npm run lint`: deterministic gates.
- `npm run desktop:win`: build, curate standalone output, smoke-test with Electron's Node runtime, and create a Windows installer.
- `npm run desktop:pack`: package an already prepared standalone build.

Use isolated synthetic test directories. Never use a personal notebook for automated tests. Smoke receipts distinguish scripted provider tests, real local-model inference, live cloud generation, numerical browser checks and native rendering. A successful sample is evidence for that sample, not a promise that every requested scene will generate perfectly.

## Attribution and licenses

This application extends [LearnHarness](https://github.com/amosblomqvist/learnharness), licensed AGPL-3.0-only. The original author and license remain in the repository. [ManimGX](https://github.com/academa-labs/manimgx) supplies the animation engine. Its own code is MIT; its native wheels are GPL-3.0-or-later as a whole. The portable runtime retains bundled license notices. This is a local build, not a proprietary license exception or a published official LearnHarness release.

The Lab bundles [Pyodide](https://github.com/pyodide/pyodide) under MPL-2.0 and its Python runtime under the Python license. Its editor uses CodeMirror under MIT. License notices and source locations are listed in [Lab runtime licenses](lab-runtime-licenses.md).
