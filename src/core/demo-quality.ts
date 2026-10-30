/** Browser-side contract for newly generated interactive learning instruments. */
export const INTERACTIVE_DEMO_PROBE = `(async () => {
const checks=[]; const check=(label,passed,detail)=>checks.push({label,passed:passed===true,...(detail?{detail:String(detail).slice(0,240)}:{})});
const api=window.__learningDemo;
check('Inspectable simulation model',!!api && typeof api.snapshot==='function' && typeof api.selfTest==='function');
if(!checks[0].passed)return {ok:false,checks};
const finite=(v,depth=0)=>depth<12 && (typeof v==='number'?Number.isFinite(v):Array.isArray(v)?v.every(x=>finite(x,depth+1)):v&&typeof v==='object'?Object.values(v).every(x=>finite(x,depth+1)):true);
const snapshot=()=>{const value=api.snapshot();if(!finite(value))throw new Error('The model snapshot contains nonfinite values.');return JSON.parse(JSON.stringify(value));};
let initial;try{initial=snapshot();check('Finite initial model values',finite(initial));}catch(e){check('Readable model snapshot',false,e.message);return {ok:false,checks};}
const toggle=document.querySelector('[data-demo-action="toggle-play"]');
check('Labeled play and pause control',!!(toggle && (toggle.textContent.trim()||toggle.getAttribute('aria-label'))));
if(toggle){if(initial.playing===true)toggle.click();else{toggle.click();check('Play changes simulation state',snapshot().playing===true);toggle.click();}check('Pause changes simulation state',snapshot().playing===false);}
const paused=snapshot();await new Promise(r=>setTimeout(r,90));check('Pause freezes numerical state',JSON.stringify(paused.values)===JSON.stringify(snapshot().values));
const ranges=[...document.querySelectorAll('input[type="range"][data-demo-control]')];
check('At least one labeled parameter control',ranges.length>0);
for(const range of ranges){
 const name=range.dataset.demoControl;const label=range.getAttribute('aria-label')||range.labels?.[0]?.textContent?.trim();check('Parameter label: '+name,!!label);
 const original=range.value;const min=Number(range.min||0),max=Number(range.max||100),step=Number(range.step||1);const old=Number(original);
 const next=Math.min(max,Math.max(min,old+(old<((min+max)/2)?1:-1)*Math.max(step,(max-min)/5)));
 range.value=String(next);range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));
 const actual=Number(range.value), value=snapshot().parameters?.[name];check('Parameter updates model: '+name,typeof value==='number' && Math.abs(value-actual)<1e-7 && actual!==old);
 range.value=original;range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));
}
const step=document.querySelector('[data-demo-action="step"]');check('Single-step control',!!step);
if(step){const before=snapshot();step.click();const after=snapshot();check('Step advances model',finite(after) && (after.steps>before.steps || JSON.stringify(before.values)!==JSON.stringify(after.values)));}
const reset=document.querySelector('[data-demo-action="reset"]');check('Reset control',!!reset);if(reset){reset.click();check('Reset restores the initial step',snapshot().steps===0);}
try{const tests=await api.selfTest();check('At least two numerical assertions',Array.isArray(tests)&&tests.length>=2);if(Array.isArray(tests))for(const t of tests.slice(0,12))check('Numerical check: '+String(t.label||'unnamed'),t.passed===true,t.detail);}catch(e){check('Numerical self-tests execute',false,e.message);}
const final=snapshot();check('Finite final model values',finite(final));
return {ok:checks.length>0 && checks.every(c=>c.passed),checks,snapshot:final,scope:'Browser execution, actual parameter interventions and supplied numerical assertions. This is not proof of all mathematics.'};
})()`;

/** An opaque-origin iframe also receives this policy when it is verified. */
export const DEMO_OFFLINE_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'";
export function offlineDemoDocument(html: string): string {
	return `<meta http-equiv="Content-Security-Policy" content="${DEMO_OFFLINE_CSP}">${html}`;
}

export function interactionReportProblem(value: unknown): string | null {
	if (!value || typeof value !== "object") return "No interaction verification report was returned.";
	const report=value as {ok?:unknown;checks?:unknown};
	if (!Array.isArray(report.checks) || report.checks.length < 6) return "The interaction report did not contain the required checks.";
	if(report.checks.some(c=>!c||typeof c!=="object"||typeof c.label!=="string"||typeof c.passed!=="boolean")) return "The interaction report contained malformed checks.";
	const failed=report.checks.filter((c): c is {label:string;passed:unknown;detail?:string}=>!!c&&typeof c==='object'&&'passed'in c&&c.passed!==true);
	if(report.ok!==true || failed.length) return failed.map(c=>`${c.label}${c.detail?`: ${c.detail}`:''}`).join('; ') || "The simulation did not pass interaction verification.";
	return null;
}
