"""Restricted scene interpreter, not an OS sandbox or arbitrary Python runner.

Only a drawing/math capability subset is provided to generated code. Native
libraries remain trusted. Windows Job Objects bound memory/CPU for each process.
"""
import ast
import builtins
import json
import math
import os
from pathlib import Path
import re
import sys

MAX_SOURCE = 60000
MAX_STEPS = 400000
MAX_OBJECTS = 2500
MAX_ARRAY = 250000

# The generated language can present mathematics, not program a typesetter.
# Check evaluated strings at the native constructor boundary as well as the AST.
LATEX_COMMANDS = set("""frac dfrac tfrac cfrac sqrt sum prod coprod int iint iiint oint
lim limsup liminf limits nolimits min max inf sup arg det dim ker rank gcd mod bmod pmod
sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth exp log ln lg
alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu
xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega
Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
infty partial nabla hbar ell Re Im wp aleph emptyset varnothing forall exists nexists
neg land lor wedge vee cup cap bigcup bigcap setminus smallsetminus subset supset
subseteq supseteq nsubseteq nsupseteq in notin ni owns le leq ge geq neq ne approx
sim simeq equiv cong propto ll gg prec succ preceq succeq parallel perp mid nmid
times cdot ast star circ bullet div pm mp opplus oplus otimes oslash odot bigoplus bigotimes
to gets mapsto leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow
uparrow downarrow updownarrow Uparrow Downarrow Updownarrow longrightarrow longleftarrow
longleftrightarrow Longrightarrow Longleftarrow Longleftrightarrow hookrightarrow
hookleftarrow rightharpoonup rightharpoondown leftharpoonup leftharpoondown rightleftharpoons
ldots cdots vdots ddots dots dotsc dotsb dotsm dotsi dotso
left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr
begin end array pmatrix bmatrix Bmatrix vmatrix Vmatrix matrix cases aligned gathered split
text textrm textnormal textbf textit textsf texttt mathrm mathnormal mathbf mathit mathsf
mathtt mathbb mathcal mathscr mathfrak boldsymbol bm operatorname operatornamewithlimits
overline underline overbrace underbrace widehat widetilde hat bar vec tilde dot ddot
dddot ddddot acute grave breve check mathring overset underset stackrel binom dbinom tbinom
boxed phantom hphantom vphantom smash substack ensuremath displaystyle textstyle
scriptstyle scriptscriptstyle quad qquad thinspace medspace thickspace enspace hspace
vspace tag notag nonumber langle rangle lceil rceil lfloor rfloor vert Vert lvert rvert
lVert rVert lbrace rbrace backslash colon angle triangle square diamond prime top bot
degree copyright registered textbackslash textasciicircum textasciitilde
""".split())
LATEX_SYMBOLS = set("\\{}_$%&#,;:! |>" )

def checked_label(value, latex=False):
    text = str(value)
    if len(text) > 20000:
        raise SceneRejected("Keep each label within 20,000 characters.")
    lowered = text.lower()
    if re.search(r"#\s*(?:read|include|import|image|eval|sys|plugin|bibliography)\b", lowered) or any(token in lowered for token in ("file://", "http://", "https://")):
        raise SceneRejected("Labels cannot load files, packages, network resources or executable markup.")
    if latex:
        # A command allowlist also rejects constructed control sequences, macro
        # definitions and file directives, even when no source literal contains one.
        if "#" in text:
            raise SceneRejected("Use MathTex for presentation mathematics, without raw Typst markup.")
        for match in re.finditer(r"\\([A-Za-z]+|[^A-Za-z])", text):
            command = match.group(1)
            if command not in LATEX_COMMANDS and command not in LATEX_SYMBOLS:
                raise SceneRejected(f"Typesetter command {command} is outside the presentation math language.")
    return text

def checked_options(value, depth=0):
    if depth > 15:
        raise SceneRejected("Use shallower scene options.")
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str) and (key in DENIED_KEYWORDS or key.startswith("_")):
                raise SceneRejected("File, font, package, shader and dynamic loading options are unavailable.")
            if key == "alignment" and item not in (None, "left", "center", "right"):
                raise SceneRejected("Text alignment must be left, center or right.")
            if isinstance(item, str):
                checked_label(item)
            checked_options(item, depth+1)
    elif isinstance(value, (list, tuple)):
        for item in value:
            checked_options(item, depth+1)

def guarded_capability(function):
    def call(*args, **kwargs):
        checked_options(args)
        checked_options(kwargs)
        return function(*args, **kwargs)
    return call

def guard_label_constructor(original, latex=False):
    def construct(instance, *args, **kwargs):
        for value in args:
            checked_label(value, latex)
        for name in ("text", "arg_separator", "tex_environment"):
            if kwargs.get(name) is not None:
                checked_label(kwargs[name], latex)
        for name in ("substrings_to_isolate", "tex_to_color_map"):
            for value in kwargs.get(name) or ():
                checked_label(value, latex)
        return original(instance, *args, **kwargs)
    return construct

MANIM_NAMES = set("""Scene ThreeDScene MovingCameraScene LinearTransformationScene
Mobject VMobject VGroup Group VDict Point VectorizedPoint ValueTracker ComplexValueTracker
Circle Dot Dot3D Ellipse Annulus AnnularSector Arc ArcBetweenPoints Sector Line DashedLine Arrow
DoubleArrow Vector DoubleArrow3D Arrow3D Polygon Polygram Polyline Triangle Square Rectangle
RoundedRectangle RegularPolygon Star Cube Cuboid Sphere Surface ParametricSurface Cylinder Cone
Torus Prism Dodecahedron Icosahedron Octahedron Tetrahedron Polyhedron ThreeDAxes Axes NumberPlane
ComplexPlane NumberLine ParametricFunction FunctionGraph ImplicitFunction Graph DiGraph
NumberLine DecimalNumber Integer Variable Text MathTex Tex Title Paragraph BulletedList
Matrix DecimalMatrix IntegerMatrix MobjectMatrix Table DecimalTable IntegerTable MobjectTable
Brace BraceBetweenPoints BraceLabel SurroundingRectangle BackgroundRectangle Underline Angle RightAngle
Cross DashedVMobject TracedPath VectorField ArrowVectorField StreamLines ImageMobjectFromCamera
Create Uncreate Write Unwrite DrawBorderThenFill FadeIn FadeOut Transform ReplacementTransform
TransformFromCopy MoveToTarget Restore Rotate Rotating GrowFromCenter GrowFromPoint GrowArrow
GrowFromEdge ShrinkToCenter Indicate Circumscribe Flash FocusOn Wiggle ApplyWave ShowPassingFlash
AnimationGroup LaggedStart LaggedStartMap Succession Wait MoveAlongPath Homotopy ComplexHomotopy
ApplyMatrix ApplyFunction ApplyMethod ApplyPointwiseFunction UpdateFromFunc UpdateFromAlphaFunc
ChangeDecimalToValue ChangingDecimal always_redraw always_shift always_rotate
interpolate inverse_interpolate normalize rotate_vector angle_between_vectors color_gradient
interpolate_color linear smooth there_and_back rush_into rush_from sigmoid
ORIGIN UP DOWN LEFT RIGHT IN OUT UL UR DL DR PI TAU DEGREES X_AXIS Y_AXIS Z_AXIS
WHITE BLACK GRAY GREY LIGHT_GRAY DARK_GRAY RED GREEN BLUE YELLOW ORANGE PURPLE PINK
TEAL MAROON GOLD BLUE_A BLUE_B BLUE_C BLUE_D BLUE_E GREEN_A GREEN_B GREEN_C GREEN_D
GREEN_E RED_A RED_B RED_C RED_D RED_E TEAL_A TEAL_B TEAL_C TEAL_D TEAL_E PURPLE_A
PURPLE_B PURPLE_C PURPLE_D PURPLE_E GRAY_A GRAY_B GRAY_C GRAY_D GRAY_E
SMALL_BUFF MED_SMALL_BUFF MED_LARGE_BUFF LARGE_BUFF BOLD NORMAL ITALIC
""".split())
MANIM_NAMES.discard("ImageMobjectFromCamera")
METHODS = set("""construct play wait add remove clear next_section
set_camera_orientation move_camera begin_ambient_camera_rotation stop_ambient_camera_rotation
add_fixed_in_frame_mobjects remove_fixed_in_frame_mobjects add_fixed_orientation_mobjects
remove_fixed_orientation_mobjects move_to shift rotate scale stretch apply_matrix apply_function
apply_complex_function set_color set_color_by_gradient set_fill set_stroke set_opacity set_z_index
set_shade_in_3d set_width set_height scale_to_fit_width scale_to_fit_height set_x set_y set_z
center to_edge to_corner next_to align_to arrange arrange_in_grid copy become save_state restore
generate_target replace match_width match_height match_x match_y match_z get_center get_x get_y
get_z get_left get_right get_top get_bottom get_corner get_start get_end get_length get_unit_vector
get_vector point_from_proportion get_value set_value increment_value add_updater remove_updater
clear_updaters suspend_updating resume_updating update get_anchors get_points set_points
set_points_as_corners set_points_smoothly append_points make_smooth insert_n_curves
plot plot_parametric_curve plot_line_graph get_graph get_area get_riemann_rectangles c2p p2c
number_to_point point_to_number get_axis_labels get_x_axis_label get_y_axis_label get_z_axis_label
get_secant_slope_group get_vertical_line get_horizontal_line input_to_graph_point
apply_transposed_matrix prepare_for_nonlinear_transform add_coordinates get_coordinate_labels
add_tip put_start_and_end_on set_fill_by_checkerboard set_color_by_checkerboard set_fill_by_value
get_subcurve get_family family_members_with_points get_parts_by_tex get_part_by_tex set_color_by_tex
animate target saved_state submobjects points width height depth camera frame time mobjects
phi_tracker theta_tracker gamma_tracker zoom_tracker light_source
append extend insert pop sort reverse items keys values get
reshape flatten ravel astype transpose dot sum mean min max argmin argmax clip round tolist
replace split join lower upper startswith endswith strip count index
""".split())
NUMPY_NAMES = set("""array asarray arange linspace logspace zeros ones eye full empty
sin cos tan arcsin arccos arctan arctan2 sinh cosh tanh exp log log2 log10 sqrt abs sign
power maximum minimum clip dot cross outer inner matmul einsum stack column_stack row_stack
vstack hstack concatenate reshape transpose meshgrid where mean sum min max argmin argmax
isclose allclose all any finite isfinite isnan nan_to_num deg2rad rad2deg radians degrees
pi e inf float64 float32 int64 int32 uint8 ndarray linalg random
""".split())
NUMPY_NAMES.discard("ndarray")
MATH_NAMES = set("sin cos tan asin acos atan atan2 sinh cosh tanh exp log log2 log10 sqrt fabs floor ceil pow hypot degrees radians pi e tau isclose isfinite factorial".split())
DENIED_KEYWORDS = set("font_paths packages package_path preamble typst_preamble tex_preamble tex_template file_name filename path output_file output_dir media_dir shader texture texture_path background_image sound_file audio_file".split())
DENIED_NAMES = set("open eval exec compile getattr setattr delattr hasattr vars dir globals locals type object super input help breakpoint memoryview __import__".split())
ALLOWED_NODES = (ast.Module, ast.Import, ast.ImportFrom, ast.alias, ast.ClassDef,
    ast.FunctionDef, ast.arguments, ast.arg, ast.Return, ast.Assign, ast.AnnAssign,
    ast.AugAssign, ast.Expr, ast.Call, ast.Name, ast.Attribute, ast.Constant,
    ast.List, ast.Tuple, ast.Dict, ast.Set, ast.ListComp, ast.SetComp, ast.DictComp,
    ast.GeneratorExp, ast.comprehension, ast.For, ast.If, ast.IfExp, ast.Compare,
    ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Subscript, ast.Slice, ast.keyword,
    ast.Lambda, ast.Assert, ast.Pass, ast.Break, ast.Continue, ast.JoinedStr,
    ast.FormattedValue, ast.operator, ast.unaryop, ast.boolop, ast.cmpop, ast.expr_context)

class SceneRejected(Exception):
    pass

def validate(source):
    if not isinstance(source, str) or not source.strip() or len(source) > MAX_SOURCE:
        raise SceneRejected("Provide a Python scene of at most 60,000 characters.")
    tree = ast.parse(source, filename="<learning-scene>")
    classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    if len(classes) != 1 or classes[0].name != "LearningScene":
        raise SceneRejected("Define exactly one class named LearningScene.")
    methods = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    if "construct" not in methods:
        raise SceneRejected("LearningScene needs construct(self).")
    if any((name in METHODS or name in {"render", "setup", "tear_down", "interact", "embed", "save", "save_image", "write_to_movie"}) and name != "construct" for name in methods):
        raise SceneRejected("Do not override renderer, camera, timing or drawing methods.")
    for base in classes[0].bases:
        name = base.attr if isinstance(base, ast.Attribute) else base.id if isinstance(base, ast.Name) else ""
        if name not in {"Scene", "ThreeDScene", "MovingCameraScene", "LinearTransformationScene"}:
            raise SceneRejected("Use a supported ManimGX Scene base.")
    calls = {n.func.attr if isinstance(n.func, ast.Attribute) else n.func.id if isinstance(n.func, ast.Name) else "" for n in ast.walk(tree) if isinstance(n, ast.Call)}
    bases = {n.attr if isinstance(n, ast.Attribute) else n.id if isinstance(n, ast.Name) else "" for n in classes[0].bases}
    if calls & {"ThreeDAxes", "Surface", "ParametricSurface", "Sphere", "Torus", "Cube", "Cylinder", "Cone", "set_camera_orientation", "move_camera", "begin_ambient_camera_rotation"} and "ThreeDScene" not in bases:
        raise SceneRejected("Use class LearningScene(m.ThreeDScene), not m.Scene, for 3D geometry or camera orientation.")
    checks = []
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODES):
            raise SceneRejected(f"Line {getattr(node, 'lineno', '?')}: {type(node).__name__} is outside the scene language.")
        if isinstance(node, (ast.Name, ast.arg)):
            name = node.id if isinstance(node, ast.Name) else node.arg
            if name.startswith("_") or name in DENIED_NAMES:
                raise SceneRejected(f"Line {node.lineno}: {name} is not a drawing or math capability.")
        if isinstance(node, ast.Attribute) and (node.attr.startswith("_") or node.attr not in METHODS | MANIM_NAMES | NUMPY_NAMES | MATH_NAMES | {"config", "background_color", "normal", "uniform", "seed", "norm", "eig", "eigh", "svd", "inv", "solve", "det"}):
            raise SceneRejected(f"Line {node.lineno}: attribute {node.attr} is not an available scene capability.")
        if isinstance(node, ast.keyword) and (node.arg is None or node.arg in DENIED_KEYWORDS or node.arg.startswith("_")):
            raise SceneRejected(f"Line {node.lineno}: file, font, package, shader and dynamic keyword loading are unavailable.")
        if isinstance(node, ast.Call) and not isinstance(node.func, (ast.Name, ast.Attribute)):
            raise SceneRejected(f"Line {node.lineno}: dynamically selected call targets are unavailable.")
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and (node.decorator_list or node.name.startswith("_") or node.type_params):
            raise SceneRejected("Decorators, private names and generic class/function declarations are unavailable.")
        if isinstance(node, ast.Import):
            if node not in tree.body: raise SceneRejected("Put approved imports at the top of the scene file.")
            if any(n.name not in {"manimgx", "numpy", "math"} or n.asname not in {None, "m", "np", "math"} for n in node.names):
                raise SceneRejected("Only manimgx, numpy and math drawing/math imports are available.")
        if isinstance(node, ast.ImportFrom):
            if node not in tree.body: raise SceneRejected("Put approved imports at the top of the scene file.")
            approved = MANIM_NAMES if node.module == "manimgx" else MATH_NAMES if node.module == "math" else NUMPY_NAMES if node.module == "numpy" else set()
            if node.level or not approved or any(n.name != "*" and (n.name not in approved or n.asname) for n in node.names):
                raise SceneRejected("Only named drawing/math capabilities can be imported.")
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            low = node.value.lower()
            if any(s in low for s in ["#read", "#include", "#import", "#image", "\\input", "\\include", "\\write", "\\openout", "file://", "http://", "https://"]):
                raise SceneRejected("External documents, network resources and typesetter file directives are unavailable.")
        if isinstance(node, ast.Assert):
            if not any(isinstance(n, (ast.Name, ast.Call)) for n in ast.walk(node.test)):
                raise SceneRejected("Assertions must check a computed value, not a literal tautology.")
            checks.append(node.lineno)
    if not checks:
        raise SceneRejected("Include at least one assert checking a known numerical result or a meaningful scene invariant.")
    return tree, checks

class Namespace:
    def __init__(self, values): object.__setattr__(self, "_values", values)
    def __getattr__(self, name):
        values = object.__getattribute__(self, "_values")
        if name not in values: raise SceneRejected(f"Capability {name} is unavailable.")
        return values[name]
    def __setattr__(self, name, value): raise SceneRejected("Library capabilities are read-only.")

def bounded_range(*args):
    result = range(*args)
    if len(result) > 10000: raise SceneRejected("Use at most 10,000 iterations in a range.")
    return result

def limits():
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        class Basic(ctypes.Structure):
            _fields_ = [("ProcessTime", ctypes.c_longlong),("JobTime", ctypes.c_longlong),("Flags",wintypes.DWORD),("MinWorkingSet",ctypes.c_size_t),("MaxWorkingSet",ctypes.c_size_t),("ActiveProcesses",wintypes.DWORD),("Affinity",ctypes.c_size_t),("Priority",wintypes.DWORD),("Scheduling",wintypes.DWORD)]
        class IO(ctypes.Structure): _fields_=[(n,ctypes.c_ulonglong) for n in ["ReadOps","WriteOps","OtherOps","ReadBytes","WriteBytes","OtherBytes"]]
        class Extended(ctypes.Structure): _fields_=[("Basic",Basic),("IO",IO),("ProcessMemory",ctypes.c_size_t),("JobMemory",ctypes.c_size_t),("PeakProcess",ctypes.c_size_t),("PeakJob",ctypes.c_size_t)]
        kernel=ctypes.WinDLL("kernel32",use_last_error=True)
        kernel.CreateJobObjectW.restype=wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE]
        kernel.GetCurrentProcess.restype=wintypes.HANDLE
        handle=kernel.CreateJobObjectW(None,None)
        info=Extended();info.Basic.Flags=0x00000002|0x00000100|0x00002000;info.Basic.ProcessTime=120*10000000;info.ProcessMemory=4*1024*1024*1024
        if not handle or not kernel.SetInformationJobObject(handle,9,ctypes.byref(info),ctypes.sizeof(info)) or not kernel.AssignProcessToJobObject(handle,kernel.GetCurrentProcess()):
            raise SceneRejected("Could not establish the native scene process resource limits.")
        globals()["_job_handle"]=handle
        kernel.QueryInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD,ctypes.c_void_p]
        def measured():
            current=Extended()
            if not kernel.QueryInformationJobObject(handle,9,ctypes.byref(current),ctypes.sizeof(current),None):
                raise SceneRejected("Could not read the native scene resource limits.")
            return {"memoryLimitBytes":int(current.ProcessMemory),"peakProcessBytes":int(current.PeakProcess),"cpuSecondsLimit":120}
        globals()["_resource_measurement"]=measured

def resource_measurement():
    measure=globals().get("_resource_measurement")
    return measure() if measure else {"memoryLimitBytes":None,"peakProcessBytes":None,"cpuSecondsLimit":None}

def load_scene(source_file, module_name):
    source=json.loads(Path(source_file).read_text(encoding="utf-8"))["sourceCode"]
    tree, check_lines=validate(source)
    limits()
    import manimgx as m
    import numpy as np
    # Inspect, poster and video execute in separate processes. Start their
    # numeric sampling identically so the reviewed geometry matches the film.
    np.random.seed(0)
    # Patch the actual constructors, so Matrix, Table, axes labels and values
    # created by trusted library code pass through the same evaluated-string gate.
    m.Text.__init__=guard_label_constructor(m.Text.__init__)
    m.MathTex.__init__=guard_label_constructor(m.MathTex.__init__,latex=True)
    executed=set(); budget=[0]
    def trace(frame,event,arg):
        if frame.f_code.co_filename == "<learning-scene>" and event == "line":
            budget[0]+=1
            if budget[0]>MAX_STEPS: raise SceneRejected("The scene exceeded its computation budget.")
            if frame.f_lineno in check_lines: executed.add(frame.f_lineno)
        return trace
    def array_guard(fn):
        def call(*args,**kwargs):
            def count(value): return math.prod(value) if isinstance(value,(tuple,list)) else value
            for key in ["num", "size", "shape"]:
                if kwargs.get(key) is not None and count(kwargs[key])>MAX_ARRAY: raise SceneRejected("Use smaller numeric arrays.")
            if fn in [np.zeros,np.ones,np.empty,np.full] and args and count(args[0])>MAX_ARRAY: raise SceneRejected("Use smaller numeric arrays.")
            if fn is np.arange and args:
                start,stop,step=(0,args[0],1) if len(args)==1 else (args[0],args[1],args[2] if len(args)>2 else 1)
                if not math.isfinite(float(step)) or step==0 or abs((stop-start)/step)>MAX_ARRAY: raise SceneRejected("Use fewer numeric samples.")
            if fn in [np.linspace,np.logspace] and len(args)>2 and args[2]>MAX_ARRAY: raise SceneRejected("Use fewer numeric samples.")
            result=fn(*args,**kwargs)
            if isinstance(result,np.ndarray) and result.size>MAX_ARRAY: raise SceneRejected("Use smaller numeric arrays.")
            return result
        return call
    numpy_values={name:array_guard(getattr(np,name)) if callable(getattr(np,name,None)) else getattr(np,name) for name in NUMPY_NAMES if hasattr(np,name) and name not in {"linalg","random"}}
    numpy_values["linalg"]=Namespace({n:getattr(np.linalg,n) for n in ["norm","eig","eigh","svd","inv","solve","det"]})
    numpy_values["random"]=Namespace({n:array_guard(getattr(np.random,n)) for n in ["normal","uniform","seed"]})
    class Config:
        def __getattr__(self,name):
            if name!="background_color": raise SceneRejected("Only background_color is configurable.")
            return m.config.background_color
        def __setattr__(self,name,value):
            if name!="background_color" or not isinstance(value,str) or len(value)>30: raise SceneRejected("Only a background color can be changed.")
            m.config.background_color=value
    class Timing:
        def play(self,*animations,**kwargs):
            duration=float(kwargs.get("run_time",max([float(getattr(a,"run_time",1)) for a in animations] or [1])))
            if not 0.01<=duration<=20 or float(self.time)+duration>120: raise SceneRejected("Keep scenes within 120 seconds, with plays at most 20 seconds.")
            return super().play(*animations,**kwargs)
        def wait(self,duration=1,*args,**kwargs):
            if not 0<=float(duration)<=20 or float(self.time)+float(duration)>120: raise SceneRejected("Keep scenes within 120 seconds, with waits at most 20 seconds.")
            return super().wait(duration,*args,**kwargs)
        def add(self,*objects):
            if len(objects)+len(self.mobjects)>MAX_OBJECTS: raise SceneRejected("Use fewer than 2,500 scene objects.")
            return super().add(*objects)
        def next_section(self,name="",*args,**kwargs):
            if hasattr(self,"_trusted_sections"): self._trusted_sections.append({"title":str(name)[:100],"start":float(self.time)})
            return super().next_section(name,*args,**kwargs)
    values={n:guarded_capability(getattr(m,n)) if callable(getattr(m,n)) else getattr(m,n) for n in MANIM_NAMES if hasattr(m,n)}
    for name in ["Scene","ThreeDScene","MovingCameraScene","LinearTransformationScene"]:
        values[name]=type("Bounded"+name,(Timing,getattr(m,name)),{})
    values["config"]=Config()
    allowed_builtins={n:getattr(builtins,n) for n in ["abs","all","any","bool","dict","enumerate","float","int","len","list","max","min","pow","reversed","round","set","sorted","str","sum","tuple","zip","Exception","ValueError"]}
    allowed_builtins["range"]=bounded_range;allowed_builtins["__build_class__"]=builtins.__build_class__
    environment={"__builtins__":allowed_builtins,"__name__":module_name,"m":Namespace(values),"np":Namespace(numpy_values),"math":Namespace({n:getattr(math,n) for n in MATH_NAMES}),**values}
    # Imports bind only the supplied facades, never the real modules.
    imports=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom))]
    for node in imports:
        if isinstance(node,ast.Import):
            for alias in node.names: environment[alias.asname or alias.name]={"manimgx":environment["m"],"numpy":environment["np"],"math":environment["math"]}[alias.name]
        elif node.module in {"math","numpy"}:
            scope=environment["math" if node.module=="math" else "np"]
            for alias in node.names:
                for name in (MATH_NAMES if node.module=="math" else NUMPY_NAMES) if alias.name=="*" else [alias.name]: environment[name]=getattr(scope,name)
    tree.body=[n for n in tree.body if not isinstance(n,(ast.Import,ast.ImportFrom))]
    sys.settrace(trace)
    exec(compile(tree,"<learning-scene>","exec"),environment,environment)
    authored=environment["LearningScene"]
    class Verified(authored):
        def construct(self):
            self._trusted_sections=[]
            try:
                authored.construct(self)
                if not executed: raise SceneRejected("No numerical or scene-invariant assertions were executed.")
            finally:
                sections=self._trusted_sections
                for i,section in enumerate(sections): section["end"]=sections[i+1]["start"] if i+1<len(sections) else float(self.time)
                Path("scene-report.json").write_text(json.dumps({"durationSeconds":float(self.time),"mathAssertions":len(executed),"sections":sections,"threeD":bool(getattr(self,"three_d",False)),"resources":resource_measurement()}),encoding="utf-8")
    Verified.__name__="LearningScene";Verified.__qualname__="LearningScene";Verified.__module__=module_name
    return Verified

def take_scene(source_file, video=False):
    """Trusted, streaming native entry. No per-play storyboard is collected here."""
    kind=load_scene(source_file,"learning_native_scene")
    from manimgx.cli.scenes import Format, take
    made,film=take(kind,Format(1280,720,30),video="LearningScene.mp4" if video else None,plays=None)
    metrics={"durationSeconds":float(made.time),"frameCount":int(film.frame_count),"resources":resource_measurement()}
    if video:
        metrics["renderSeconds"]=float(film.export.seconds) if film.export else None
        Path("render-metrics.json").write_text(json.dumps(metrics),encoding="utf-8")
    print(json.dumps(metrics))

def contact_sheet(plan_file):
    """Compact chronological review frames and a poster, bounded independently of plays."""
    from PIL import Image, ImageDraw, ImageFont
    plan=json.loads(Path(plan_file).read_text(encoding="utf-8"))
    samples=plan["samples"]
    if not 1<=len(samples)<=12:
        raise SceneRejected("Use at most 12 review frames.")
    tile_width,tile_height,gap,caption=960,540,8,28
    out_width,out_height,out_caption=640,360,24
    columns=min(3,len(samples));rows=math.ceil(len(samples)/columns)
    sheet=Image.new("RGB",(columns*(out_width+gap)-gap,rows*(out_height+out_caption+gap)-gap),(23,27,29))
    draw=ImageDraw.Draw(sheet);font=ImageFont.load_default(size=15)
    poster_index=min(range(len(samples)),key=lambda i:abs(float(samples[i]["seconds"])-float(plan["durationSeconds"])*0.65))
    for i,sample in enumerate(samples):
        page,index=i//6,i%6
        source=Path("review-source.png" if page==0 else f"review-source-{page+1}.png")
        with Image.open(source) as image:
            page_columns=1 if image.width==tile_width else 2
            column,row=index%page_columns,index//page_columns
            x,y=column*(tile_width+gap),row*(tile_height+caption+gap)+caption
            if x+tile_width>image.width or y+tile_height>image.height:
                raise SceneRejected("The native storyboard did not contain every requested review frame.")
            picture=image.crop((x,y,x+tile_width,y+tile_height))
        if i==poster_index:
            picture.save("poster.png")
        x,y=(i%columns)*(out_width+gap),(i//columns)*(out_height+out_caption+gap)
        label=f"{float(sample['seconds']):.2f}s  {str(sample['label'])[:65]}"
        draw.text((x+5,y+3),label,font=font,fill=(232,237,233))
        sheet.paste(picture.resize((out_width,out_height),Image.Resampling.BILINEAR),(x,y+out_caption))
    sheet.save("storyboard.png",compress_level=3)

if __name__ == "__main__":
    try:
        if sys.argv[1] == "validate":
            source=json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["sourceCode"]
            tree,checks=validate(source);print(json.dumps({"ok":True,"assertions":len(checks)}))
        elif sys.argv[1] in {"analyze","render"}:
            take_scene(sys.argv[2],video=sys.argv[1]=="render")
        elif sys.argv[1] == "contact-sheet":
            contact_sheet(sys.argv[2])
        elif sys.argv[1] == "poster":
            from PIL import Image
            image=Image.open(sys.argv[2]);image.crop((0,28,image.width,image.height)).save(sys.argv[3])
    except Exception as error:
        print(str(error),file=sys.stderr);sys.exit(1)
