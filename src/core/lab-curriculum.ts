import type { LabCatalog, LabItem, LabQuestion, LabResource, LabTrackId, LabCodingSpec } from './lab.ts';

// Original Learning Studio exercises. External resources are references, not copied lessons.
const refs = {
  python: { id: 'python-tutorial', title: 'Python tutorial', url: 'https://docs.python.org/3/tutorial/', kind: 'docs' },
  collections: { id: 'python-collections', title: 'Python collections', url: 'https://docs.python.org/3/library/collections.html', kind: 'docs' },
  pytorch: { id: 'pytorch-basics', title: 'PyTorch: learn the basics', url: 'https://docs.pytorch.org/tutorials/beginner/basics/intro.html', kind: 'course' },
  numpy: { id: 'numpy-basics', title: 'NumPy fundamentals', url: 'https://numpy.org/doc/stable/user/basics.html', kind: 'docs' },
  rag: { id: 'rag-paper', title: 'Retrieval-Augmented Generation, original paper', url: 'https://arxiv.org/abs/2005.11401', kind: 'article' },
  attention: { id: 'attention-paper', title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762', kind: 'article' },
  circuits: { id: 'mit-circuits', title: 'MIT: Circuits and Electronics', url: 'https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/', kind: 'course' },
  http: { id: 'http-semantics', title: 'HTTP semantics, RFC 9110', url: 'https://www.rfc-editor.org/rfc/rfc9110.html', kind: 'docs' },
  sql: { id: 'postgres-isolation', title: 'PostgreSQL transaction isolation', url: 'https://www.postgresql.org/docs/current/transaction-iso.html', kind: 'docs' },
  otel: { id: 'otel', title: 'OpenTelemetry concepts', url: 'https://opentelemetry.io/docs/concepts/', kind: 'docs' },
} satisfies Record<string, LabResource>;
let order = 0;
function item(trackId: LabTrackId, id: string, title: string, summary: string, content: string, extra: Partial<LabItem> = {}): LabItem {
  return { id, trackId, kind: 'lesson', title, summary, content, difficulty: 'Foundation', minutes: 20, order: ++order,
    tags: [trackId], prerequisites: [], objectives: [summary], hints: ['Work through a small concrete example before generalizing.', 'State what must remain true after every step.'],
    questions: [], resources: [trackId === 'ai' ? refs.pytorch : trackId === 'electronics' ? refs.circuits : trackId === 'systems' ? refs.http : refs.python], ...extra };
}
const q = (id: string, prompt: string, options: string[], answer: number, explanation: string): LabQuestion => ({ id, prompt, options, answer, explanation });
const open = (id: string, prompt: string, explanation: string, rubric: string[]): LabQuestion => ({ id, prompt, explanation, rubric });
function coding(track: LabTrackId, id: string, title: string, summary: string, content: string, spec: LabCodingSpec, extra: Partial<LabItem> = {}) {
  return item(track, id, title, summary, content, { kind: 'coding', coding: spec, minutes: 30, questions: [open(`${id}-reason`, 'Explain your invariant and one edge case before running the code.', spec.complexity, ['A correct invariant', 'An explicit edge case', 'Time and space reasoning'])], ...extra });
}
const py = (entrypoint: string, parameters: string, solution: string, tests: LabCodingSpec['tests'], complexity: string): LabCodingSpec => ({ language: 'python', entrypoint, starterCode: `def ${entrypoint}(${parameters}):\n    # Return the requested result.\n    pass\n`, solution, tests, complexity });
const t = (id: string, name: string, args: unknown[], expected: unknown, tolerance?: number) => ({ id, name, args, expected, ...(tolerance === undefined ? {} : { tolerance }) });

export const LAB_CATALOG: LabCatalog = {
  version: 1,
  tracks: [
    { id: 'dsa', title: 'Algorithms', description: 'Reason about data, invariants and complexity.', icon: 'code' },
    { id: 'ai', title: 'AI engineering', description: 'Build, evaluate and explain learning systems.', icon: 'brain' },
    { id: 'electronics', title: 'Electronics', description: 'Connect circuit models to measurable behavior.', icon: 'circuit' },
    { id: 'systems', title: 'System design', description: 'Make tradeoffs under load and failure.', icon: 'network' },
  ],
  items: [
    item('dsa', 'complexity', 'Growth, not stopwatch time', 'Distinguish input growth from machine speed.', `## A model for cost
An algorithm examines a collection of n records. A full scan reads each record once, so doubling n roughly doubles that work. Comparing every record with every later record takes n(n-1)/2 comparisons. Doubling n approaches four times the comparisons.

Big O is an upper bound on growth, not a promise about seconds. Name the operation you count and the input variables. A loop over n rows with m columns costs O(nm), not automatically O(n²).

## Work it out
For n=8 a pairwise comparison makes 28 comparisons. For n=16 it makes 120. A hash lookup is expected O(1) under a good hash model, but collisions and resizing matter. A sorted-array binary search uses O(log n) comparisons, while insertion can still require O(n) shifts.

## Your turn
Compare scanning a million IDs once with building a lookup set and querying it ten thousand times. Include preprocessing, extra memory and the expected case assumption.`, {
      questions: [q('cost-1', 'A loop visits n rows and m columns per row. What is its cost?', ['O(n+m)', 'O(nm)', 'O(log n)', 'O(n²) always'], 1, 'There are n groups of m visits. Only if m=n does this become O(n²).'), open('cost-2', 'When would you prefer a scan over a lookup set?', 'A one-off lookup on a small collection can avoid allocation and preprocessing. Repeated queries can justify the index.', ['Workload frequency', 'Memory cost', 'Preprocessing'])],
    }),
    coding('dsa', 'pair-sum', 'Find a pair in one pass', 'Use a lookup invariant instead of comparing every pair.', `## Contract
Return the indices of the first pair found by scanning left to right whose values sum to target. For each index j, use the earliest previous matching index i. Return [] if no pair exists. Never reuse the same element.

Example: values=[4,1,6,3], target=7 returns [1,2]. The 1 was already seen when the 6 arrives.

## Reason before coding
After processing a prefix, the lookup should map each seen value to its earliest index. Check the complement before adding the current value. Otherwise a target of twice the current value could accidentally reuse one position.

Discuss why duplicate values and negative numbers do not break the invariant.`, py('find_pair', 'values, target', `def find_pair(values, target):
    seen = {}
    for j, value in enumerate(values):
        if target - value in seen:
            return [seen[target - value], j]
        if value not in seen:
            seen[value] = j
    return []
`, [t('pair-normal','A pair inside the list',[[4,1,6,3],7],[1,2]), t('pair-dup','Distinct positions with equal values',[[3,3],6],[0,1]), t('pair-none','No solution',[[3],6],[]), t('pair-negative','Negative complement',[[-4,2,7,5],1],[0,3]), t('pair-first','Keep earliest index',[[2,2,5],7],[0,2])], 'Expected O(n) time and O(n) extra space. The hash table stores only the scanned prefix.'), { prerequisites: ['complexity'], hints: ['Ask what earlier value would complete the current one.', 'Check the complement before saving the current index.', 'Do not replace an earlier index for a repeated value.'] }),
    coding('dsa', 'binary-boundary', 'Find the first qualifying value', 'Use binary search on a monotone condition.', `## Contract
Given a sorted list of numbers and a target, return the first index with value >= target. If no value qualifies, return len(values). Empty input returns 0.

## The invariant
Use a half-open interval [lo, hi). Everything before lo is too small. Everything at or after hi is known to qualify, or hi is the end sentinel. Each update must shrink the interval. When lo==hi, the boundary has been found.

Example: [1,3,3,8], target=3 returns 1, not an arbitrary occurrence. Trace every interval on paper before writing the loop.`, py('lower_bound','values, target',`def lower_bound(values, target):
    lo, hi = 0, len(values)
    while lo < hi:
        mid = (lo + hi) // 2
        if values[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo
`, [t('bound-dup','First equal value',[[1,3,3,8],3],1),t('bound-gap','Insertion in a gap',[[1,3,8],6],2),t('bound-end','Beyond last',[[1,2],9],2),t('bound-empty','Empty input',[[],1],0),t('bound-start','Before first',[[2,4],0],0)],'O(log n) time, O(1) extra space. Each iteration removes at least half the remaining interval.'),{prerequisites:['complexity']}),
    coding('dsa','window-distinct','A window without repeats','Maintain a valid interval as input grows.',`## Contract
Return the length of the longest contiguous substring with no repeated characters. Treat characters as Python string elements, with case sensitivity. Empty input returns 0.

In "abca", the answer is 3. When the second a arrives, move the left boundary past the prior a, but never move it backwards. In "abba", the final a is outside the current valid window and should not reset the left boundary to 1.

## Derive it
Keep each character's most recent index. After adjusting the left edge, every character inside [left,right] is unique. Explain why each position is processed only once despite the moving window.`,py('longest_unique','text',`def longest_unique(text):
    left, best = 0, 0
    last = {}
    for right, char in enumerate(text):
        left = max(left, last.get(char, -1) + 1)
        last[char] = right
        best = max(best, right - left + 1)
    return best
`,[t('window-normal','Overlapping windows',['abcabcbb'],3),t('window-backward','Never move left backwards',['abba'],2),t('window-same','Repeated character',['aaaa'],1),t('window-empty','Empty string',[''],0),t('window-case','Case sensitive',['aAbB'],4)],'O(n) time and O(k) space for k distinct characters.'),{difficulty:'Intermediate',prerequisites:['pair-sum']}),
    coding('dsa','bfs-distance','Shortest path in an unweighted graph','Separate visiting order from path length.',`## Contract
An adjacency dictionary maps node names to lists of neighbors. Return the minimum number of edges from start to goal, or -1 if unreachable. A missing node has no outgoing neighbors. A node reaches itself in zero edges.

## Why a queue works
Breadth-first search explores distance d before d+1. Mark a node visited when enqueuing it, not after removing it, so converging paths do not enqueue duplicates. The first discovery gives a shortest path only when every edge has equal cost.

Trace a diamond A→B, A→C, B→D, C→D. Then add D→A and explain why the search terminates.`,py('shortest_distance','graph, start, goal',`def shortest_distance(graph, start, goal):
    from collections import deque
    queue = deque([(start, 0)])
    seen = {start}
    while queue:
        node, distance = queue.popleft()
        if node == goal:
            return distance
        for neighbor in graph.get(node, []):
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append((neighbor, distance + 1))
    return -1
`,[t('bfs-diamond','Converging routes',[{A:['B','C'],B:['D'],C:['D'],D:[]},'A','D'],2),t('bfs-cycle','Cycle',[{A:['B'],B:['A']},'A','Z'],-1),t('bfs-self','Start is goal',[{},'X','X'],0),t('bfs-directed','Respect direction',[{A:['B'],B:[]},'B','A'],-1)],'O(V+E) time and O(V) space for the reachable subgraph.'),{difficulty:'Intermediate',prerequisites:['complexity'],resources:[refs.collections]}),
    coding('dsa','merge-intervals','Merge overlapping reservations','Turn many comparisons into a sorted scan.',`## Contract
Input is a list of closed numeric intervals [start,end], each with start<=end. Return sorted merged intervals. Touching endpoints overlap: [1,3] and [3,5] become [1,5]. Do not mutate the input.

## Useful invariant
Sort by start. The output contains disjoint intervals, and only its final interval can overlap the next candidate. Extend that last end with max, because an interval can be nested inside another.

Contrast closed intervals here with half-open reservations [start,end), where touching reservations may stay separate. A specification decides the answer.`,py('merge_intervals','intervals',`def merge_intervals(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return merged
`,[t('merge-many','Unsorted overlaps',[[[5,7],[1,3],[2,4]]],[[1,4],[5,7]]),t('merge-touch','Touching endpoints',[[[1,3],[3,5]]],[[1,5]]),t('merge-nested','Nested interval',[[[1,10],[2,3]]],[[1,10]]),t('merge-empty','No intervals',[[]],[])],'O(n log n) time for sorting and O(n) output space.'),{prerequisites:['complexity']}),
    coding('dsa','coin-change','Fewest coins, with impossible states','Build a dynamic program from a recurrence.',`## Contract
Given distinct positive integer coin values and a nonnegative integer amount, return the fewest coins needed to make that amount using unlimited coins. Return -1 if impossible. The amount 0 needs no coins.

## Derive the recurrence
Let dp[x] be the fewest coins for amount x. The last coin c leaves amount x-c, so dp[x] is 1+the smallest reachable dp[x-c]. Initialize only dp[0]=0. An unreachable state must not accidentally look cheaper than a real solution.

Greedy fails for coins [1,3,4] and amount 6: 4+1+1 uses three coins, but 3+3 uses two.`,py('fewest_coins','coins, amount',`def fewest_coins(coins, amount):
    dp = [amount + 1] * (amount + 1)
    dp[0] = 0
    for value in range(1, amount + 1):
        for coin in coins:
            if coin <= value:
                dp[value] = min(dp[value], dp[value - coin] + 1)
    return dp[amount] if dp[amount] <= amount else -1
`,[t('coins-greedy','Greedy counterexample',[[1,3,4],6],2),t('coins-impossible','No exact sum',[[2],3],-1),t('coins-zero','Zero amount',[[2,5],0],0),t('coins-empty','No coins',[[],7],-1),t('coins-usual','Several choices',[[1,2,5],11],3)],'O(amount × number of coins) time and O(amount) space.'),{difficulty:'Intermediate',prerequisites:['complexity']}),
    item('ai','vectors','Embeddings and the geometry of similarity','Separate representation, similarity and retrieval.',`## A useful coordinate system
An embedding maps an item to a vector. Training makes certain relationships easier to measure, but a vector is not a universal meaning. A model trained for retrieval can represent queries and passages differently while putting compatible items nearby.

For a=[3,4] and b=[6,8], the dot product is 50. Their lengths are 5 and 10, so cosine similarity is 50/(5×10)=1. Direction agrees even though magnitude differs.

## What changes the ranking?
Dot product is affected by length. Cosine divides by both lengths. For unit-normalized vectors, cosine and dot-product rankings agree. Euclidean distance on unit vectors is also monotonic with cosine: distance²=2-2cosine. A zero vector has no defined cosine direction.

## Retrieval is a pipeline
Use a compatible embedding model and preprocessing for both indexed items and incoming queries. Store the model version with the index. Changing models usually requires re-embedding the documents. Evaluate relevance with realistic queries instead of assuming a high similarity score is a probability of correctness.`,{resources:[refs.numpy,refs.rag],questions:[q('vec-unit','For unit vectors, what changes between cosine and dot-product ranking?',['They reverse','Nothing','Dot product becomes Euclidean distance','Cosine is always zero'],1,'Both lengths equal one, so the normalization denominator is one.'),open('vec-zero','How should a system handle an empty document that yields a zero vector?','Define an explicit policy, such as reject or skip it. Do not invent a cosine value and treat it as semantic evidence.',['Undefined direction','Explicit handling','Evaluation'])]}),
    coding('ai','cosine','Implement cosine similarity','Make normalization and undefined inputs explicit.',`## Contract
Return cosine similarity for two equal-length numeric vectors. Return None if lengths differ, input is empty, or either vector has zero norm. Inputs are finite real numbers. Use ordinary Python and the standard library.

For [1,0] and [0,1], return 0. For [1,2] and [2,4], return 1. For opposite vectors, return -1.

## Check the meaning
The normalized angle measures direction, not magnitude. Explain a use case where magnitude matters and cosine could discard information.`,py('cosine_similarity','a, b',`def cosine_similarity(a, b):
    import math
    if not a or len(a) != len(b):
        return None
    na = math.sqrt(sum(x*x for x in a))
    nb = math.sqrt(sum(y*y for y in b))
    if na == 0 or nb == 0:
        return None
    return sum(x*y for x, y in zip(a, b)) / (na*nb)
`,[t('cos-unit','Orthogonal',[[1,0],[0,1]],0,1e-8),t('cos-scale','Same direction',[[1,2],[2,4]],1,1e-8),t('cos-opposite','Opposite',[[1,0],[-1,0]],-1,1e-8),t('cos-zero','Zero vector',[[0,0],[1,2]],null),t('cos-length','Different dimensions',[[1],[1,2]],null)],'O(d) time for d dimensions; O(1) auxiliary space with generator sums.'),{prerequisites:['vectors']}),
    item('ai','gradient','Gradient descent as local information','Connect slope, learning rate and loss.',`## A step is a proposal
For L(w)=(w-3)², the derivative is 2(w-3). A gradient step is w_new=w-eta×2(w-3). At w=0 and eta=0.1, the next value is 0.6 and loss falls from 9 to 5.76.

The gradient points toward fastest local increase in Euclidean coordinates, so subtract it to descend. This is a local statement. A large step can overshoot. With eta=1 on this quadratic, values oscillate between 0 and 6. With eta>1 their distance from 3 grows.

## More than one parameter
For a vector of weights, each partial derivative describes sensitivity to one coordinate. Scaling an input changes the shape of the loss surface and can make the same learning rate behave differently. Mini-batches add noise to the gradient estimate. Adaptive optimizers change the update rule, not the objective.

## Try a visual
Use Teach this to ask for an interactive loss surface. Predict the next position before moving the learning-rate slider. Compare the numerical derivative with a small finite difference.`,{prerequisites:['vectors'],questions:[q('grad-one','At w=0, eta=0.1 for L=(w-3)², what is w_new?',['-0.6','0.6','3','6'],1,'The derivative is -6, so 0-0.1×(-6)=0.6.'),open('grad-rate','Why can a lower training loss fail to improve real performance?','The training data can be unrepresentative or overfit. Evaluate on held-out data with a suitable metric.',['Generalization','Held-out data','Metric choice'])]}),
    coding('ai','stable-softmax','Softmax without overflow','Preserve probabilities while shifting logits.',`## Contract
Return a probability list for a list of finite logits using exp(z_i)/sum(exp(z)). Empty input returns []. Avoid overflow for logits such as [1000,1001].

## The algebra
Subtracting the same constant from every logit multiplies numerator and denominator by the same factor, leaving probabilities unchanged. Subtract the maximum so all exponent arguments are <=0.

Softmax is invariant to shifts but not scaling. Dividing logits by a positive temperature changes concentration. Explain why probabilities from a model are not automatically calibrated.`,py('softmax','logits',`def softmax(logits):
    import math
    if not logits:
        return []
    maximum = max(logits)
    weights = [math.exp(x - maximum) for x in logits]
    total = sum(weights)
    return [weight / total for weight in weights]
`,[t('soft-equal','Equal logits',[[0,0]],[0.5,0.5],1e-7),t('soft-large','Large logits',[[1000,1001]],[0.26894142137,0.73105857863],1e-7),t('soft-single','One choice',[[-20]],[1],1e-8),t('soft-empty','Empty input',[[]],[])],'O(n) time and O(n) output space.'),{prerequisites:['gradient'],difficulty:'Intermediate'}),
    item('ai','attention','Attention: queries, keys and values','Trace one attention head with dimensions.',`## Route information by relevance
Let Q contain queries, K keys and V values. For n tokens, one head commonly has Q and K shaped n×d_k, and V shaped n×d_v. Scores QKᵀ have shape n×n. Divide by sqrt(d_k), apply any mask, and softmax along the key dimension. Multiplying the resulting weights by V gives n×d_v outputs.

## A two-item example
A query assigns scores [0,ln 3] to two keys. Softmax gives weights [0.25,0.75]. If values are [2,0] and [0,4], the weighted output is [0.5,3]. This is a weighted combination of values, not an index lookup.

## Why the mask matters
In causal self-attention, a token cannot attend to future tokens. Mask forbidden scores before softmax. Zeroing weights afterward without renormalizing changes their sum and therefore the output scale.

Attention weights alone do not establish a causal explanation of a model's answer. Multi-head attention, residual paths and later layers complicate interpretation.`,{prerequisites:['stable-softmax'],difficulty:'Intermediate',resources:[refs.attention,refs.pytorch],questions:[q('att-shape','Q is 6×8 and K is 6×8. QKᵀ is:', ['8×8','6×6','6×8','8×6'],1,'The inner dimension 8 is summed over; each of six queries compares with six keys.'),open('att-mask','Where does a causal mask go, and why?','Apply it to scores before softmax, excluding forbidden positions from normalization.',['Before softmax','Future tokens excluded','Renormalization'])]}),
    item('ai','rag-pipeline','RAG from question to cited answer','Locate failure at the correct pipeline stage.',`## Two paths
Indexing: extract text, preserve source metadata, split into coherent chunks, embed, and store. Answering: understand the question, retrieve candidates, optionally rerank, build bounded context, generate an answer, then expose citations.

## An example failure
A policy document says returns are allowed within 30 days, except damaged items reported within 7 days. If chunking separates the exception from its condition, retrieval may find a true sentence but produce a wrong answer. More retrieved tokens do not automatically solve this.

## Diagnose, then change
First ask whether the evidence exists in the corpus. Then test retrieval recall, reranker ordering, context assembly, and answer faithfulness separately. Keep a small set of realistic questions, expected evidence and acceptable answers. Include questions the corpus cannot answer.

Permissions must be enforced during retrieval, not after a private passage reaches the model. Treat retrieved text as untrusted evidence, not instructions. A source that says "ignore prior instructions" is not an authorized system message.`,{prerequisites:['vectors'],difficulty:'Intermediate',resources:[refs.rag],questions:[q('rag-debug','Correct evidence never appears in top candidates. What should you inspect first?',['Response style','Retrieval and corpus coverage','Voice speed','Only the final model temperature'],1,'Generation cannot reliably recover evidence that was never retrieved.'),open('rag-deny','Design a test for a question the corpus cannot answer.','Use an unsupported question with no gold passage. Check abstention and absence of fabricated citations.',['Unsupported query','Abstention','Citation checking'])]}),
    coding('ai','retrieval-metrics','Measure retrieval quality','Separate precision at k from reciprocal rank.',`## Contract
Return [precision_at_k, reciprocal_rank] for ranked document IDs and a collection of relevant IDs. Use only the first k ranked entries for precision. If fewer than k exist, divide by the number returned. Return precision 0 for k<=0 or no returned entries. Reciprocal rank is 1/rank of the first relevant item in the full ranking, or 0. Rankings contain unique IDs.

Example: ranked=["b","a","c"], relevant=["a","c"], k=2 yields [0.5,0.5]. Precision describes concentration in the visible set; reciprocal rank rewards an early first hit. Neither proves a generated answer is faithful.`,py('retrieval_metrics','ranked, relevant, k',`def retrieval_metrics(ranked, relevant, k):
    relevant = set(relevant)
    selected = ranked[:max(0, k)]
    precision = sum(doc in relevant for doc in selected) / len(selected) if selected else 0
    reciprocal = next((1 / rank for rank, doc in enumerate(ranked, 1) if doc in relevant), 0)
    return [precision, reciprocal]
`,[t('metric-normal','Two measures',[['b','a','c'],['a','c'],2],[0.5,0.5],1e-8),t('metric-none','No relevant hit',[['a','b'],['c'],2],[0,0]),t('metric-short','Fewer than k',[['a'],['a'],5],[1,1]),t('metric-zero','Zero precision window',[['a'],['a'],0],[0,1]),t('metric-empty','Empty ranking',[[],['a'],3],[0,0])],'O(n+r) time and O(r+k) auxiliary space, where r is the relevant-set size.'),{prerequisites:['rag-pipeline']}),
    item('ai','evaluation','An evaluation set that catches regressions','Design tests around failure modes, not demo prompts.',`## Define the task first
A useful evaluation begins with the user decision it supports. For a support assistant, measure factual correctness, citation support, appropriate refusal, latency and cost. A fluent answer can still fail all useful criteria.

## Build a small, varied set
Collect representative questions, difficult boundary cases, ambiguous questions and unanswerable requests. Keep development examples separate from a held-out test set. Store expected evidence and a rubric, not just one exact reference sentence.

## Evaluate changes
Run old and new configurations on the same cases. Record model, prompt, corpus and retrieval versions. Inspect regressions by category. An average can hide that a rare but important class became much worse. If an AI judge scores answers, calibrate it against human judgments and measure its disagreements.

## Stop guessing
Write one test that would fail if retrieval lost an exception clause, one that would catch an invented citation, and one that would catch a prompt injection embedded in a document.`,{prerequisites:['retrieval-metrics'],difficulty:'Intermediate',questions:[q('eval-held','Why hold out some cases?', ['To make the score look higher','To estimate performance beyond tuned examples','To avoid reading failures','To eliminate all uncertainty'],1,'Tuning against every test can overfit the evaluation itself.'),open('eval-rubric','Write a three-point rubric for a cited answer.','Check correctness, whether citations support each material claim, and whether unsupported questions lead to appropriate uncertainty.',['Correctness','Support','Uncertainty'])]}),
    item('electronics','voltage-current','Voltage, current and a complete path','Use units and conservation before manipulating formulas.',`## Two different quantities
Voltage is electric potential difference, measured in volts. Current is the rate of charge flow, measured in amperes. A component can have voltage across it with almost no current through it, as in an ideal open circuit.

For an ideal resistor, V=IR. A 1kΩ resistor across 5 V carries 5 mA. Power is P=VI=25mW. Keep prefixes explicit: kilo is 1000 and milli is 0.001.

## Conservation
At an ideal node, currents sum to zero with a consistent sign convention. Around a closed loop, voltage rises and drops sum to zero in the lumped circuit model. A resistor does not "use up" current. It converts electrical energy into heat.

## Check a model
Real sources have current limits and internal resistance. Before wiring hardware, check component voltage and power ratings. The exercises here model ideal low-voltage circuits and are not instructions for mains work.`,{questions:[q('ohm-power','5V across 1 kΩ gives what current?', ['5A','0.5A','5mA','1mA'],2,'I=5/1000A=0.005A=5mA.'),open('ohm-open','Can there be voltage but no current?', 'Yes. In an ideal open circuit no closed conducting path exists, even with a voltage difference.',['Potential difference','Complete path','Ideal model'])]}),
    coding('electronics','voltage-divider','A voltage divider under load','See why an unloaded formula can be misleading.',`## Contract
Return output voltage for source vin, upper resistor r1 and lower resistor r2, with optional load resistance load in parallel with r2. All supplied resistances are positive. None means no load.

Unloaded output is vin×r2/(r1+r2). With a load, replace r2 by r2×load/(r2+load). A high load resistance draws little current; a low load resistance reduces the output.

With vin=10V and r1=r2=1kΩ, unloaded output is 5 V. A 1 kΩ load makes the lower equivalent 500 Ω and output about 3.333 V. This is why a divider is not a universal power supply.`,py('divider_voltage','vin, r1, r2, load',`def divider_voltage(vin, r1, r2, load):
    lower = r2 if load is None else r2 * load / (r2 + load)
    return vin * lower / (r1 + lower)
`,[t('divider-none','Unloaded',[10,1000,1000,null],5,1e-8),t('divider-load','Equal load',[10,1000,1000,1000],10/3,1e-8),t('divider-off','Zero source',[0,100,200,300],0),t('divider-asym','Asymmetric',[12,1000,2000,null],8,1e-8)],'O(1) time and space. The result assumes ideal resistors and a source that maintains vin.'),{prerequisites:['voltage-current']}),
    item('electronics','rc-response','An RC circuit remembers its past','Predict a transient before reaching steady state.',`## One state variable
An ideal capacitor obeys i=C×dv/dt. In a series resistor-capacitor circuit driven by a voltage step, the time constant is tau=RC. Starting at 0 V with a constant input Vin, capacitor voltage is Vin×(1-exp(-t/tau)).

For R=10kΩ and C=10µF, tau=0.1s. At one time constant the voltage reaches about 63.2% of its final value. At five time constants it is about 99.3%, not exactly 100%.

## Intuition
Initially the capacitor voltage cannot jump under finite current. As it charges, the resistor sees a smaller voltage drop, so current decreases. The model stores energy in the electric field. A capacitor is neither always an open circuit nor always a short circuit; the timescale matters.

## Investigation
Sketch voltage and current over time. Double R, then double C. Both double the time constant, but changing C also changes energy stored at a given voltage.`,{prerequisites:['voltage-current'],questions:[q('rc-tau','R=10kΩ and C=10µF gives tau:', ['100s','1s','0.1s','0.001s'],2,'10000×0.00001=0.1 seconds.'),open('rc-curve','Why does charging slow down?', 'The difference between source and capacitor voltage falls, reducing resistor current and therefore dv/dt.',['Voltage difference','Ohm law','Capacitor equation'])]}),
    item('electronics','sampling','Sampling and aliasing','Identify when different signals look identical.',`## Discrete observations
Sampling records a continuous signal at spaced instants. For an ideal signal bandlimited strictly below fs/2, sufficient ideal samples determine it. Real systems need an anti-alias filter before conversion, because frequencies already folded into samples cannot generally be removed afterward.

## A concrete ambiguity
Sampling a 900 Hz sine wave at 1000 samples per second can produce a 100 Hz alias, with phase/sign depending on the waveform convention. The sample sequence alone cannot tell which original signal was present.

## Do not confuse axes
Sample rate limits temporal bandwidth. Bit depth limits amplitude resolution and quantization behavior. Increasing bit depth does not fix aliasing. Increasing sample rate does not automatically remove analog noise.

Design a sensor acquisition path: analog filter, ADC, timestamping, processing and storage. Name one failure at each stage.`,{prerequisites:['rc-response'],difficulty:'Intermediate',questions:[q('sample-filter','Where must an anti-alias filter act?', ['Only after the ADC','Before sampling','Only in the database','After plotting'],1,'After sampling, aliased components can be indistinguishable from legitimate lower frequencies.'),open('sample-bits','Why do more ADC bits not solve aliasing?', 'Bits increase amplitude resolution, while aliasing comes from insufficient temporal sampling of bandwidth.',['Amplitude','Time','Filter'])]}),
    item('electronics','logic-state','Combinational logic and state','Separate a function of inputs from remembered history.',`## Two kinds of circuit
A combinational circuit computes outputs from present inputs, after propagation delay. A sequential circuit also depends on stored state. A counter must remember a previous value; an AND gate does not.

## A button is not a perfect edge
A mechanical button can bounce, generating multiple transitions. A debounce design can require a stable value for a chosen interval. If a signal crosses clock domains, setup and hold timing can be violated and cause metastability. Synchronizers reduce risk; they do not provide a mathematical guarantee of zero failures.

## Model a traffic light
Define states, allowed transitions, input events and outputs. Then separate the transition logic from the state register. Ask what happens at reset and for invalid states. A state diagram should specify behavior, not merely draw boxes.`,{prerequisites:['voltage-current'],questions:[q('logic-state','Which requires stored state?', ['A two-input AND','A binary comparator','A counter','A combinational decoder'],2,'The next count depends on the previous count.'),open('logic-reset','What should a finite-state controller specify about reset?', 'Its initial state, output behavior and how reset is released relative to the clock, depending on the hardware design.',['Initial state','Outputs','Timing'])]}),
    item('systems','requirements','Start with a workload, not a diagram','Translate a product request into measurable constraints.',`## Turn a feature into questions
"Build a note-sharing service" leaves important decisions open. Ask who edits, what is shared, how large pages are, whether offline edits are required, and which kinds of delay users tolerate. State assumptions before choosing a database.

## Estimate with units
At 100 requests per second and 20 kB per response, payload throughput is about 2 MB/s before overhead. At an average response time of 0.2 s, Little's law suggests about 20 requests in flight in a stable system. Tail latency and bursts still require separate capacity planning.

## Choose a boundary
Define correctness conditions, such as "a revoked collaborator cannot read new content". Define a latency goal and measurement window. Separate durable page data, transient presence and derived search indexes.

A useful architecture diagram labels responsibilities and data movement. It also names failure cases and operations needed for recovery.`,{questions:[q('req-load','100 requests/s ×0.2s means approximately:', ['500 concurrent','20 concurrent','0.002 concurrent','2000 concurrent'],1,'In a stable system, average concurrency is throughput times average latency.'),open('req-correct','Name one correctness condition for shared notes.','Examples include enforcing revocation, not losing acknowledged edits, and preventing private notes from entering another user\'s search results.',['Observable rule','Failure scenario','Test'])]}),
    item('systems','cache','Caching is a consistency decision','Trade freshness for latency deliberately.',`## What is cached?
A cache stores a derived or duplicated value for quicker reuse. In cache-aside, read the cache first, load from the source on a miss, and populate the cache. The source of truth still matters when cached data expires or disagrees.

## A stale permission example
If access rights are cached for ten minutes, revocation might not take effect immediately. Some content tolerates stale display data; permissions often require stronger handling. Separate public immutable assets from private mutable records.

## Misses can be expensive
Many simultaneous misses for a popular key can overload the backend. Coalescing requests, adding TTL jitter, prewarming or serving permitted stale data can help. A cache also needs bounded size and an eviction policy.

Design invalidation for a document title change and for an access revocation. Explain why the two policies might differ.`,{prerequisites:['requirements'],difficulty:'Intermediate',questions:[q('cache-source','In cache-aside, what happens on a miss?', ['The cache becomes authoritative','Load from the source, then populate','Return random stale data','Delete the record'],1,'The cache accelerates reads but the source handles misses.'),open('cache-revoke','How would you avoid stale authorization?', 'Revalidate critical permission checks at the trusted boundary, or use bounded/revocable authorization versions with explicit guarantees.',['Trusted boundary','Revocation window','Tests'])]}),
    item('systems','transactions','Transactions and competing updates','Identify the anomaly before choosing isolation.',`## A lost update
Two clients read a balance of 100. Each independently adds 10 and writes 110. The final value is 110, although two increments occurred. Atomic update expressions or suitable concurrency control can prevent this pattern.

## Isolation is not one universal behavior
Databases define isolation levels with different guarantees and implementation details. A transaction groups work but does not automatically make every interleaving safe. Read the database's actual guarantees. Use a version field for optimistic concurrency and reject an update whose expected version no longer matches.

## A retry needs identity
If a payment request times out, the client may retry after the server already committed. An idempotency key can connect retries to one operation. Store the result and key consistently with the state transition, and define expiry and mismatch behavior.

Write a timeline for two clients editing the same page, then a timeline where the network response is lost after commit.`,{prerequisites:['requirements'],resources:[refs.sql,refs.http],difficulty:'Intermediate',questions:[q('tx-version','A client saves with version 5, but the server has version 6. What should a version check do?', ['Silently overwrite','Detect a conflict','Ignore version 6','Delete the page'],1,'The check prevents a stale snapshot from silently replacing newer work.'),open('tx-idem','What must happen when the same idempotency key is reused with different content?', 'Reject the mismatch rather than treating a different operation as the same retry.',['Payload association','Atomic persistence','Conflict handling'])]}),
    item('systems','queues','Queues, retries and duplicate work','Design consumers that survive redelivery.',`## Decouple time
A queue lets a producer hand work to a consumer without waiting for completion. It absorbs bounded bursts and enables independent scaling, but does not create unlimited capacity. Watch backlog age, not only queue length.

## The acknowledgment gap
A worker can finish a side effect and crash before acknowledging. The queue may deliver the same message again. Acknowledge too early and work may be lost. At-least-once delivery therefore needs idempotent side effects or transactional coordination.

## Failures should converge
Use bounded retries with backoff and jitter for transient failures. Send repeatedly failing work to a reviewable dead-letter path. Keep an operation ID and observable status. Retrying a permanently invalid payload forever is not resilience.

Design a thumbnail generation job. Explain which output can be regenerated, how duplicate jobs behave, and what the user sees when a source was deleted.`,{prerequisites:['transactions'],difficulty:'Intermediate',questions:[q('queue-dup','Worker commits output, then crashes before ack. What can happen?', ['The queue proves exactly-once','The job can be redelivered','The output must vanish','No retry is possible'],1,'The broker may not know the work completed, so safe consumers must tolerate redelivery.'),open('queue-age','Why monitor oldest-message age?', 'A growing delay can violate user expectations even when queue length looks moderate, especially with slow or stuck work.',['User delay','Backpressure','Alert threshold'])]}),
    item('systems','observability','Make failures explainable','Connect logs, metrics and traces to a user symptom.',`## Start from a symptom
"Answers are slow" could mean model latency, retrieval, queue delay or a blocked UI. Track end-to-end latency and break it into stages. A trace connects operations for one request; a metric shows aggregate behavior; a log records a specific event.

## Avoid misleading averages
Nine requests at 100 ms and one at 10 s average 1090 ms. Most users did not experience the average. Examine percentiles and sample sizes, plus error rate and saturation. Define the interval and what counts as a request.

## Useful without leaking
Attach request IDs, model/version identifiers and durations. Do not log API keys or entire private notes by default. Sampling can reduce volume, but make failure sampling and retention explicit.

Create an incident investigation checklist for an AI tutor that responds slowly after a release. Compare retrieval, generation, rendering and client timing before changing providers.`,{prerequisites:['queues'],resources:[refs.otel],questions:[q('obs-trace','Which helps connect operations for one request?', ['A trace','Only total disk size','A feature list','Only average uptime'],0,'A trace relates spans along a request path.'),open('obs-private','What would you log for an AI request without storing the user\'s notes?', 'Record request ID, selected model/version, stage durations, token counts and classified error, with appropriate retention.',['Debuggable metadata','No credentials','Privacy'])]}),
    item('systems','design-sync','Design a collaborative notebook','Reason through offline edits, presence and permissions.',`## The brief
Design a notebook used on desktop and tablets. Users can edit offline, reconnect, invite viewers or editors, and see where collaborators are working. Assume 10,000 daily users, average 20 pages each, with text and movable drawing objects.

## Required decisions
Separate durable edits from ephemeral cursor presence. Decide how concurrent text and object changes merge, how identity and access are checked, and how a client resumes after disconnecting. Explain the revision or operation model rather than just naming WebSockets.

## Failure walkthrough
Two users move the same object offline. One deletes a page while another edits it. A collaborator loses access during a long connection. A media upload succeeds but the page reference fails to save. For each, state user-visible behavior and recovery.

Sketch the client, identity boundary, synchronization service, durable store, attachment store and event delivery. Label trust boundaries. Use Teach this to turn the proposal into a diagram and challenge its assumptions.`,{kind:'design',difficulty:'Advanced',minutes:45,prerequisites:['transactions','queues'],questions:[open('sync-model','Propose the edit model and conflict behavior.','No single model fits every object. Explain operation identity, ordering/merging, idempotency, deletion semantics and resynchronization.',['Text convergence','Object conflicts','Reconnect protocol','Deletion policy']),open('sync-security','How do you enforce permission changes on existing sessions?','Revalidate mutations at the server and revoke or downgrade active subscriptions. Never trust a client role flag.',['Server checks','Existing connections','Attachment access']),open('sync-observe','What proves the system works under disconnects?','Use two-client interleaving tests, replayed events, crash/reconnect tests and permission-revocation tests.',['Deterministic scenarios','No lost acknowledged edits','Monitoring'])]}),
    item('ai','design-rag','Design a trustworthy research assistant','Build a RAG proposal you can evaluate.',`## The brief
Researchers upload private PDFs and ask questions with page-level citations. Some PDFs are scanned. Documents can be updated or deleted. The assistant must decline unsupported claims and respect project permissions.

## Work in stages
Specify ingestion and OCR confidence, chunk boundaries, metadata, embedding versions, retrieval, reranking, context assembly and citation validation. Make uncertainty visible when a formula or chart is unreadable.

## Constraints
Assume 100,000 pages, mixed languages, a three-second target before the first useful response and occasional long-running imports. Separate ingestion latency from answering latency. Cache only where privacy and versioning allow it.

## Evaluation
Provide a small test matrix for retrieval misses, contradictory sources, malicious document instructions, deleted content and questions outside the corpus. Explain what you measure and what improvement would change your design.`,{kind:'design',difficulty:'Advanced',minutes:45,prerequisites:['rag-pipeline','evaluation','queues'],resources:[refs.rag,refs.otel],questions:[open('rag-design','Describe your end-to-end architecture.','Include source provenance, permissions, bounded context and a deletion/version strategy.',['Ingestion','Retrieval','Permissions','Citations','Versioning']),open('rag-eval','What experiment would tell you whether reranking is worth its latency?','Compare matched queries with and without reranking using evidence relevance, answer support and latency distributions.',['Controlled comparison','Quality metric','Latency tradeoff'])]}),
    item('dsa','interview-algorithms','Algorithms interview','Explain before coding and defend your tradeoffs.',`## A realistic interview
Work through the questions one at a time. Clarify constraints, propose a simple baseline, improve it, and test edge cases. Use the timer if useful. The coach can challenge assumptions but an AI score is feedback, not a hiring prediction.

## Rules
Talk through an invariant. Do not jump to a memorized pattern without explaining why it fits. When you revise your approach, record what changed and why.

Afterward, compare your answer with the rubric and write one specific improvement for the next attempt.`,{kind:'interview',minutes:30,prerequisites:['pair-sum','binary-boundary','bfs-distance'],questions:[open('int-a1','A sorted log has repeated timestamps. How do you find the first event at or after a target time?','Binary-search the first qualifying position with a shrinking half-open interval.',['Clarifying sorted input','Boundary invariant','Duplicates','O(log n)']),open('int-a2','Find the shortest number of hops between two people in an unweighted social graph. What changes if edges have different costs?','BFS for equal costs; a cost-aware shortest path algorithm for weighted edges with appropriate assumptions.',['Queue layers','Visited timing','Unreachable case','Weighted distinction']),open('int-a3','A streaming string needs its longest substring without repeats. Explain a linear-time approach.','Maintain a left boundary and last-seen indices; never move the left boundary backward.',['Window invariant','Repeated input','Complexity','Edge cases'])]}),
    item('ai','interview-ai','AI engineer interview','Connect mathematical understanding to production decisions.',`## The interview
Answer from first principles, then relate the idea to a system you would build. State assumptions and the evidence you would collect. If you do not know, identify what you would test rather than inventing a confident explanation.

The questions cover representations, attention, RAG and evaluation. Use a numerical example where possible. A correct definition without an engineering consequence is incomplete.

Reflect on which answers you understood and which relied on memorized words. Save one weak area for the next session.`,{kind:'interview',difficulty:'Intermediate',minutes:35,prerequisites:['attention','rag-pipeline','evaluation'],questions:[open('int-ai1','When do cosine and dot-product rankings agree, and when might they differ?','They agree for vectors normalized to equal norms; varying lengths affect dot product.',['Normalization','Magnitude','Concrete example']),open('int-ai2','A RAG answer cites a real document but is wrong. How do you debug it?','Inspect evidence coverage, retrieval, chunk context, reranking, generation and citation support separately.',['Stage isolation','Exception handling','Evaluation case']),open('int-ai3','Explain scaled dot-product attention with dimensions and a causal mask.','QK transpose produces query-by-key scores; scale, mask, normalize and combine values.',['Shapes','Softmax axis','Mask timing','Values']),open('int-ai4','Your new prompt improves average quality but breaks unsupported questions. Would you ship it?','Compare risk-weighted categories and criteria; fix abstention regressions or constrain rollout rather than trusting the average.',['Category analysis','Held-out test','Risk tradeoff','Rollback'])]}),
    item('electronics','interview-electronics','Electronics interview','Explain the model and its limits.',`## The interview
Keep units visible. State idealizations before calculating. Explain what you would measure on a safe low-voltage circuit and which observation would falsify your model.

Use sketches to show paths, reference nodes and transient behavior. If an answer changes with timescale or load, say so explicitly.`,{kind:'interview',difficulty:'Intermediate',minutes:25,prerequisites:['voltage-divider','rc-response','sampling'],questions:[open('int-e1','Why does a resistor divider output fall when you attach a load?','The load is in parallel with the lower resistor and changes the ratio.',['Parallel equivalent','Current','Numerical example']),open('int-e2','What happens to capacitor voltage and resistor current after a step input?','Capacitor voltage changes continuously and approaches the final value; current decays with the RC time constant.',['Initial condition','Time constant','Steady state']),open('int-e3','A sensor sampled at 1 kHz seems to contain 100 Hz. Could the analog source be 900 Hz?','Yes, aliasing can make those sample sequences ambiguous. An analog bandwidth limit is needed.',['Aliasing','Pre-sampling filter','Bit-depth distinction'])]}),
    item('systems','interview-systems','System design interview','Make a design survive failure, not just traffic.',`## The interview
Start with requirements and approximate load. Propose a small architecture, then stress it with failure scenarios. Separate things you know from assumptions requiring measurement.

Keep tradeoffs explicit. A database, cache or queue name is not a design until you explain the data model, boundaries and behavior on retry or disconnection.`,{kind:'interview',difficulty:'Advanced',minutes:40,prerequisites:['cache','transactions','queues','observability'],questions:[open('int-s1','Design an API that creates a resource exactly once from the user\'s perspective despite retries.','Use operation identity/idempotency, atomic state/result persistence, conflict rules and retrievable status.',['Retry ambiguity','Atomicity','Idempotency expiry','Payload mismatch']),open('int-s2','How would you keep private search results from leaking after access is revoked?','Enforce authorization at trusted retrieval and fetch boundaries and account for caches and active sessions.',['Server enforcement','Cache policy','Active sessions','Tests']),open('int-s3','A queue backlog grows after a release. What do you inspect before adding workers?','Check arrival/service rates, slow jobs, downstream saturation, retry loops and oldest-message age.',['Rate reasoning','Bottleneck','Failure loops','Observability'])]}),
  ],
};
