extends Node3D
## Pixel to 3D Batch Builder: model preview.
##
## Loads every .glb in a folder (flat, one folder per model, or a zip of either) while running, so there is no
## import step per model, and shows them under real Godot lighting with a switch for each surface-detail map.
## The whole viewer is built in code: this script and main.tscn are all there is.
##
## Where the models come from, in this order: a `--folder=<path>` after `--` on the command line, the `models`
## folder next to this script (if it holds any models), the folder opened last time, and else the samples.
## Dropping a folder, a zip or .glb files on the window, or "Open folder...", loads that instead.
##
## Project settings worth knowing (they live in project.godot, which the Godot editor rewrites whenever it opens the
## project and drops any comments in it, so they're explained here instead):
## - rendering/anti_aliasing/screen_space_roughness_limiter/enabled = false. Godot's roughness limiter draws thin
##   light lines along the pixel edges of bumpy, shiny models: it roughens the surface wherever the nearest-filtered
##   (so crisp-edged) normal map changes. The guide explains the setting for your own game.
## - rendering/anti_aliasing/quality/msaa_3d = 2 (4×), for smooth model edges; the textures stay crisp regardless.
## - Everything else is Godot's default for a Forward+ project; the window size is just a comfortable start.

# "Cartridge Night", the app's colour scheme (DESIGN.md §13).
const GRAPE := Color("#171327")
const PLUM := Color("#262043")
const PLUM_2 := Color("#2e2750")
const HIGHLIGHT := Color("#3b3163")
const FIELD := Color("#1c1733")
const LINE := Color("#4a3f78")
const INK := Color("#f5f0ff")
const MIST := Color("#b9aee0")
const FAINT := Color("#8a7fb5")
const LIME := Color("#8fdc4a")
const SUNSHINE := Color("#ffd23f")
const PERI := Color("#7c6cff")
const SKY := Color("#4db8ff")
const MINT := Color("#52e3a4")
const AMBER := Color("#ffb020")
const CHERRY := Color("#ff4d6d")
const CREAM := Color("#fffbe8")

const LIGHTS := ["Sun", "Studio", "Shade", "Moving lamp"]
const LIGHT_TIPS := [
	"Daylight: a sun from the upper left and a blue sky, like Godot's own editor preview.",
	"Three lamps (key, fill and a rim light from behind) in a dark room. Good for judging shapes.",
	"No sun at all, only soft light from the sky. Crevice shadows in the file (AO map) show fully here, because engines use them to darken this kind of light.",
	"A warm lamp that circles the model in a dark room. The best way to see the bumpy surface catch the light.",
]
const SETTINGS_FILE := "user://preview.cfg"
const DEFAULT_YAW := deg_to_rad(35.0)
const DEFAULT_PITCH := deg_to_rad(25.0)

## One loaded model.
class Model:
	var path := ""            ## the file, or "<zip>::<file inside>"
	var name := ""            ## the file name without ".glb"
	var label := ""           ## what the list shows: the name, then the folder it's in
	var sort_key := ""        ## the path under the opened folder, for the list order
	var slot: Node3D          ## placed in the grid (or at the origin)
	var spin: Node3D          ## turned by the turntable
	var size := Vector3.ZERO  ## size in metres
	var surfaces: Array[Dictionary] = []  ## {mi, index, orig, live, metal, rough}
	var error := ""
	var triangles := 0
	var texture := Vector2i.ZERO
	var has_normal := false
	var has_ao := false
	var has_trims := false
	var unlit := false
	var metal := 0.0
	var rough := 1.0

var models: Array[Model] = []
var current := 0
var grid_view := false
var sources := PackedStringArray()  ## what's loaded: folders, zips or files
var source_label := ""
var load_run := 0                   ## a new load stops an older one that's still going

# look settings (saved between runs)
var use_normal := true
var use_ao := true
var ao_light := 0.0
var use_trims := true
var colour_only := false
var light_setup := 0
var turntable := false
var show_floor := true
var last_folder := ""

# camera
var cam: Camera3D
var yaw := DEFAULT_YAW
var pitch := DEFAULT_PITCH
var dist := 2.0
var target := Vector3.ZERO
var fit_radius := 0.5
var dragging := 0  # 0, MOUSE_BUTTON_LEFT (turn) or MOUSE_BUTTON_RIGHT (move)
var drag_moved := 0.0

# scene
var stage: Node3D
var env: Environment
var sky: Sky
var sun: DirectionalLight3D
var fill: DirectionalLight3D
var rim: DirectionalLight3D
var lamp: OmniLight3D
var lamp_angle := 0.0
var floor_mesh: MeshInstance3D

# interface
var ui: Control
var list: ItemList
var folder_label: Label
var notice: Label
var name_label: Label
var details_label: RichTextLabel
var ao_slider: HSlider
var ao_value: Label
var checks := {}
var view_buttons: Array[Button] = []
var light_buttons: Array[Button] = []
var folder_dialog: FileDialog


func _ready() -> void:
	_load_settings()
	_build_scene()
	_build_ui()
	get_window().files_dropped.connect(_on_files_dropped)
	get_window().title = "Pixel to 3D model preview"
	_apply_light()
	_sync_controls()
	_open_first()


# ------------------------------------------------------------------ the 3D scene

func _build_scene() -> void:
	var we := WorldEnvironment.new()
	env = Environment.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky = Sky.new()
	sky.sky_material = sky_mat
	env.sky = sky
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.shadow_bias = 0.03
	sun.shadow_normal_bias = 1.0
	sun.shadow_blur = 0.6
	add_child(sun)
	fill = DirectionalLight3D.new()
	add_child(fill)
	rim = DirectionalLight3D.new()
	add_child(rim)
	lamp = OmniLight3D.new()
	lamp.shadow_enabled = true
	lamp.light_color = Color(1.0, 0.82, 0.6)
	lamp.omni_attenuation = 1.2
	add_child(lamp)

	floor_mesh = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(400, 400)
	floor_mesh.mesh = plane
	var floor_mat := StandardMaterial3D.new()
	floor_mat.albedo_color = Color(0.33, 0.31, 0.37)
	floor_mat.roughness = 0.95
	floor_mesh.material_override = floor_mat
	floor_mesh.position.y = -0.002
	add_child(floor_mesh)

	stage = Node3D.new()
	add_child(stage)
	cam = Camera3D.new()
	cam.fov = 40.0
	cam.near = 0.01
	cam.far = 1000.0
	add_child(cam)


## Points a directional light so it shines from `from` towards the origin.
func _aim(light: DirectionalLight3D, from: Vector3) -> void:
	light.basis = Basis.looking_at(-from.normalized(), Vector3.UP)


func _apply_light() -> void:
	var sky_mat := sky.sky_material as ProceduralSkyMaterial
	sun.visible = false
	fill.visible = false
	rim.visible = false
	lamp.visible = false
	env.tonemap_exposure = 1.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_BG
	match light_setup:
		0:  # Sun: Godot's own preview look
			env.background_mode = Environment.BG_SKY
			env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
			env.ambient_light_energy = 1.0
			sky_mat.sky_energy_multiplier = 1.0
			sun.visible = true
			sun.light_energy = 1.0
			sun.light_color = Color(1.0, 0.97, 0.92)
			_aim(sun, Vector3(-0.6, 1.1, 0.7))
		1:  # Studio: key, fill and rim in a dark room
			env.background_mode = Environment.BG_COLOR
			env.background_color = Color(0.13, 0.12, 0.17)
			env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
			env.ambient_light_color = Color(0.55, 0.55, 0.62)
			env.ambient_light_energy = 0.35
			env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY  # metals need something to reflect
			sky_mat.sky_energy_multiplier = 0.6
			sun.visible = true
			sun.light_energy = 1.0
			sun.light_color = Color(1.0, 0.98, 0.95)
			_aim(sun, Vector3(-0.8, 0.9, 1.0))
			fill.visible = true
			fill.light_energy = 0.35
			fill.light_color = Color(0.8, 0.85, 1.0)
			_aim(fill, Vector3(1.0, 0.3, 0.6))
			rim.visible = true
			rim.light_energy = 0.9
			_aim(rim, Vector3(0.3, 0.7, -1.0))
		2:  # Shade: sky light only
			env.background_mode = Environment.BG_SKY
			env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
			env.ambient_light_energy = 1.0
			sky_mat.sky_energy_multiplier = 1.0
			env.tonemap_exposure = 1.3
		3:  # Moving lamp in the dark
			env.background_mode = Environment.BG_COLOR
			env.background_color = Color(0.05, 0.045, 0.08)
			env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
			env.ambient_light_color = Color(0.45, 0.4, 0.6)
			env.ambient_light_energy = 0.25
			lamp.visible = true
			lamp.light_energy = 1.1
	_place_lamp()


func _place_lamp() -> void:
	var r := maxf(fit_radius * 2.2, 0.4)
	lamp.omni_range = r * 5.0
	lamp.position = target + Vector3(cos(lamp_angle) * r, fit_radius * 1.2 + 0.1, sin(lamp_angle) * r)


func _process(delta: float) -> void:
	if turntable:
		for m in _shown():
			m.spin.rotate_y(delta * 0.6)
	if light_setup == 3:
		lamp_angle += delta * 0.9
		_place_lamp()


# ------------------------------------------------------------------ camera

func _update_camera() -> void:
	var dir := Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch))
	cam.position = target + dir * dist
	cam.look_at(target, Vector3.UP)
	sun.directional_shadow_max_distance = maxf(dist * 3.0, 4.0)


## Frames the shown model (or every model in the grid) without changing the viewing angle.
func _fit() -> void:
	var box := AABB()
	var first := true
	for m in _shown():
		var b := AABB(m.slot.position + Vector3(-m.size.x / 2, 0, -m.size.z / 2), m.size)
		box = b if first else box.merge(b)
		first = false
	if first:
		box = AABB(Vector3(-0.5, 0, -0.5), Vector3.ONE)
	target = box.get_center()
	fit_radius = maxf(box.size.length() / 2.0, 0.05)
	dist = fit_radius / sin(deg_to_rad(cam.fov) / 2.0) * (0.8 if grid_view else 1.05)
	_update_camera()
	_place_lamp()


func _reset_view() -> void:
	yaw = DEFAULT_YAW
	pitch = DEFAULT_PITCH
	for m in models:
		if m.spin:
			m.spin.rotation = Vector3.ZERO
	_fit()


func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton and ev.pressed:
		match ev.button_index:
			MOUSE_BUTTON_WHEEL_UP:
				dist *= 0.9
				_update_camera()
			MOUSE_BUTTON_WHEEL_DOWN:
				dist *= 1.1
				_update_camera()
			MOUSE_BUTTON_LEFT:
				dragging = MOUSE_BUTTON_LEFT
				drag_moved = 0.0
			MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE:
				dragging = MOUSE_BUTTON_RIGHT
				drag_moved = 0.0
	elif ev is InputEventMouseMotion and dragging == 0 and grid_view:
		var m := _pick(ev.position)
		_show_details(m if m else null)
	elif ev is InputEventKey and ev.pressed and not ev.echo:
		match ev.keycode:
			KEY_RIGHT, KEY_DOWN, KEY_PAGEDOWN:
				_step(1)
			KEY_LEFT, KEY_UP, KEY_PAGEUP:
				_step(-1)
			KEY_SPACE:
				turntable = not turntable
				_sync_controls()
				_save_settings()
			KEY_G:
				_set_grid(not grid_view)
			KEY_F:
				_reset_view()
			KEY_R:
				_reload()
			KEY_1, KEY_2, KEY_3, KEY_4:
				_set_light(ev.keycode - KEY_1)


# Motion and release go through _input, so a drag that ends over a panel still ends.
func _input(ev: InputEvent) -> void:
	if dragging == 0:
		return
	if ev is InputEventMouseMotion:
		drag_moved += ev.relative.length()
		if dragging == MOUSE_BUTTON_LEFT:
			yaw -= ev.relative.x * 0.008
			pitch = clampf(pitch + ev.relative.y * 0.008, deg_to_rad(-85), deg_to_rad(85))
		else:
			var b := cam.global_transform.basis
			target += (-b.x * ev.relative.x + b.y * ev.relative.y) * dist * 0.0012
		_update_camera()
	elif ev is InputEventMouseButton and not ev.pressed and (ev.button_index == dragging or dragging == MOUSE_BUTTON_RIGHT and ev.button_index == MOUSE_BUTTON_MIDDLE):
		if dragging == MOUSE_BUTTON_LEFT and drag_moved < 5.0 and grid_view:
			var m := _pick(ev.position)
			if m:
				_select(models.find(m))
				_set_grid(false)
		dragging = 0


## The model under the mouse in the grid, or null.
func _pick(pos: Vector2) -> Model:
	var from := cam.project_ray_origin(pos)
	var dir := cam.project_ray_normal(pos)
	var best: Model = null
	var best_d := INF
	for m in _shown():
		var box: AABB = m.spin.global_transform * AABB(Vector3(-m.size.x / 2, 0, -m.size.z / 2), m.size)
		var hit = box.intersects_ray(from, dir)
		if hit != null and from.distance_to(hit) < best_d:
			best_d = from.distance_to(hit)
			best = m
	return best


# ------------------------------------------------------------------ finding and loading models

func _open_first() -> void:
	var here := ProjectSettings.globalize_path("res://")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--folder="):
			_open([arg.trim_prefix("--folder=")])
			return
	var models_dir := here.path_join("models")
	if not _find_files(models_dir).is_empty():
		_open([models_dir])
	elif last_folder != "" and not _find_files(last_folder).is_empty():
		_open([last_folder])
	else:
		_open([here.path_join("samples")], "the sample models")


## Every .glb and .zip under a folder (a few levels deep), a zip or .glb itself, in natural order.
func _find_files(path: String, depth := 0) -> PackedStringArray:
	var out := PackedStringArray()
	var ext := path.get_extension().to_lower()
	if FileAccess.file_exists(path):
		if ext == "glb" or ext == "zip":
			out.append(path)
		return out
	var d := DirAccess.open(path)
	if d == null or depth > 4:
		return out
	var files := d.get_files()
	for f in files:
		var e := f.get_extension().to_lower()
		if e == "glb" or e == "zip":
			out.append(path.path_join(f))
	for sub in d.get_directories():
		if not sub.begins_with("."):
			out.append_array(_find_files(path.path_join(sub), depth + 1))
	return out


func _natural_less(a: Model, b: Model) -> bool:
	return a.sort_key.naturalnocasecmp_to(b.sort_key) < 0


## Loads models from folders, zips and .glb files (dropped, picked or found), replacing what's shown.
func _open(paths: PackedStringArray, label := "") -> void:
	load_run += 1
	var run := load_run
	sources = paths
	for m in models:
		if m.slot:
			m.slot.queue_free()
	models.clear()
	list.clear()
	current = 0
	if paths.size() == 1:
		source_label = label if label != "" else paths[0]
	else:
		source_label = label if label != "" else "%d dropped files" % paths.size()
	folder_label.text = source_label
	folder_label.tooltip_text = "\n".join(paths)

	# every file, labelled by its place under the folder it was found in
	var found: Array[Model] = []
	for p in paths:
		var base := p if DirAccess.dir_exists_absolute(p) else p.get_base_dir()
		for f in _find_files(p):
			if f.get_extension().to_lower() == "zip":
				found.append_array(_zip_entries(f, f.get_file()))
			else:
				var m := Model.new()
				m.path = f
				_name_model(m, f.trim_prefix(base).trim_prefix("/"))
				found.append(m)
	found.sort_custom(_natural_less)
	# when every model sits in the same folder (one zip, say), the folder says nothing: show just the names
	var folders := {}
	for m in found:
		folders[m.sort_key.get_base_dir()] = true
	if folders.size() == 1:
		for m in found:
			m.label = m.name
	models = found
	if models.is_empty():
		_say("No models found in %s. Export some in the app first (② with \"3D model\" ticked), then drop the folder or zip here." % source_label.get_file(), AMBER)
		_show_details(null)
		_set_grid(grid_view)
		return
	for m in models:
		list.add_item(m.label)
		list.set_item_tooltip(list.item_count - 1, m.path)
	list.select(0)

	# load them all, a few per frame so the window stays responsive
	var t0 := Time.get_ticks_msec()
	for i in models.size():
		_load_model(models[i])
		var m := models[i]
		if m.error != "":
			list.set_item_custom_fg_color(i, CHERRY)
			list.set_item_text(i, m.label + "  (can't load)")
		if i == 0:
			_set_grid(grid_view)
		if i % 12 == 11:
			_say("Loading %d of %d..." % [i + 1, models.size()], SKY)
			await get_tree().process_frame
			if run != load_run:
				return
	var bad := models.filter(func(m): return m.error != "").size()
	var msg := "%d model%s from %s" % [models.size(), "" if models.size() == 1 else "s", source_label.get_file()]
	if label == "the sample models":
		msg = "Showing the sample models. Drop your own models (a folder, a zip or .glb files) onto this window, or click Open folder."
	_say(msg + ("  ·  %d couldn't be loaded" % bad if bad else ""), CHERRY if bad else MIST)
	print("Loaded %d models in %d ms" % [models.size(), Time.get_ticks_msec() - t0])
	_set_grid(grid_view)


## Names a model from its path under the opened folder. The list shows the name first and then the folder, without
## the folder "One folder per model" adds (".../chest/chest.glb" is just "chest").
func _name_model(m: Model, rel: String) -> void:
	var parts := rel.get_basename().split("/")
	if parts.size() >= 2 and parts[parts.size() - 1] == parts[parts.size() - 2]:
		parts.remove_at(parts.size() - 1)
	m.sort_key = "/".join(parts)
	m.name = parts[parts.size() - 1]
	parts.remove_at(parts.size() - 1)
	m.label = m.name if parts.is_empty() else "%s   ·  %s" % [m.name, "/".join(parts)]


func _zip_entries(zip_path: String, prefix: String) -> Array[Model]:
	var out: Array[Model] = []
	var z := ZIPReader.new()
	if z.open(zip_path) != OK:
		var bad := Model.new()
		bad.path = zip_path
		_name_model(bad, prefix)
		bad.error = "The zip couldn't be opened."
		out.append(bad)
		return out
	for f in z.get_files():
		if f.get_extension().to_lower() == "glb":
			var m := Model.new()
			m.path = zip_path + "::" + f
			_name_model(m, prefix.get_basename() + "/" + f)
			out.append(m)
	z.close()
	return out


func _load_model(m: Model) -> void:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := OK
	if m.path.contains("::"):
		var z := ZIPReader.new()
		err = z.open(m.path.get_slice("::", 0))
		if err == OK:
			var bytes := z.read_file(m.path.get_slice("::", 1))
			z.close()
			err = doc.append_from_buffer(bytes, "", state)
	else:
		err = doc.append_from_file(m.path, state)
	if err != OK:
		m.error = "Godot couldn't read this file (%s)." % error_string(err)
		return
	var scene := doc.generate_scene(state)
	if scene == null:
		m.error = "The file holds no model."
		return
	m.slot = Node3D.new()
	m.spin = Node3D.new()
	m.slot.add_child(m.spin)
	m.spin.add_child(scene)
	var box := _collect(scene, Transform3D.IDENTITY, m)
	m.size = box.size
	# stand the model on the floor, turning around the middle of its footprint
	scene.position = Vector3(-box.get_center().x, -box.position.y, -box.get_center().z)
	m.slot.visible = false
	stage.add_child(m.slot)
	for s in m.surfaces:
		_apply_surface(s)


## Gathers the meshes' materials and facts, and returns the model's bounding box.
func _collect(n: Node, xf: Transform3D, m: Model) -> AABB:
	var box := AABB()
	var have := false
	var here: Transform3D = xf * (n.transform if n is Node3D else Transform3D.IDENTITY)
	if n is MeshInstance3D and n.mesh:
		var mesh: Mesh = n.mesh
		box = here * mesh.get_aabb()
		have = true
		for i in mesh.get_surface_count():
			var arrays := mesh.surface_get_arrays(i)
			var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			m.triangles += (idx.size() if idx.size() > 0 else (arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
			var orig := mesh.surface_get_material(i) as StandardMaterial3D
			if orig == null:
				continue
			var live := orig.duplicate() as StandardMaterial3D
			n.set_surface_override_material(i, live)
			var s := {"orig": orig, "live": live, "metal": orig.metallic, "rough": orig.roughness}
			if orig.albedo_texture:
				m.texture = orig.albedo_texture.get_size()
			m.unlit = orig.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED
			m.has_normal = m.has_normal or orig.normal_enabled
			m.has_ao = m.has_ao or orig.ao_enabled
			if orig.roughness_texture:
				m.has_trims = true
				var body := _body_values(orig)
				s.metal = body.x
				s.rough = body.y
			m.metal = s.metal
			m.rough = s.rough
			m.surfaces.append(s)
	for c in n.get_children():
		var b := _collect(c, here, m)
		if b.size != Vector3.ZERO:
			box = b if not have else box.merge(b)
			have = true
	return box


## The model's own Metal and Rough: the most common values in the shiny-trims texture (the body; trims are the
## few lighter pixels). Used when Shiny trims is switched off.
func _body_values(mat: StandardMaterial3D) -> Vector2:
	var img := mat.roughness_texture.get_image()
	if img == null:
		return Vector2(mat.metallic, mat.roughness)
	if img.is_compressed():
		img.decompress()
	var colour: Image = mat.albedo_texture.get_image() if mat.albedo_texture else null
	var counts := {}
	var w := img.get_width()
	var h := img.get_height()
	var step := maxi(1, int(sqrt(w * h / 4096.0)))
	for y in range(0, h, step):
		for x in range(0, w, step):
			if colour and colour.get_pixel(x * colour.get_width() / w, y * colour.get_height() / h).a < 0.5:
				continue
			var c := img.get_pixel(x, y)
			var key := Vector2i(roundi(c.b * 255), roundi(c.g * 255))
			counts[key] = counts.get(key, 0) + 1
	var best := Vector2i(roundi(mat.metallic * 255), roundi(mat.roughness * 255))
	var most := 0
	for k in counts:
		if counts[k] > most:
			most = counts[k]
			best = k
	return Vector2(best.x / 255.0, best.y / 255.0)


## Sets a surface's live material from the file's material and the switches.
func _apply_surface(s: Dictionary) -> void:
	var orig: StandardMaterial3D = s.orig
	var live: StandardMaterial3D = s.live
	live.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST  # the file says so too; this keeps it certain
	var unlit := orig.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED
	live.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED if colour_only or unlit else orig.shading_mode
	live.normal_enabled = orig.normal_enabled and use_normal
	live.ao_enabled = orig.ao_enabled and use_ao
	live.ao_light_affect = ao_light
	if use_trims or orig.roughness_texture == null:
		live.roughness_texture = orig.roughness_texture
		live.metallic_texture = orig.metallic_texture
		live.roughness = orig.roughness
		live.metallic = orig.metallic
	else:
		live.roughness_texture = null
		live.metallic_texture = null
		live.roughness = s.rough
		live.metallic = s.metal


func _apply_all_surfaces() -> void:
	for m in models:
		for s in m.surfaces:
			_apply_surface(s)


func _reload() -> void:
	if not sources.is_empty():
		_open(sources, "the sample models" if source_label == "the sample models" else "")


func _on_files_dropped(files: PackedStringArray) -> void:
	var paths := PackedStringArray()
	for f in files:
		if DirAccess.dir_exists_absolute(f) or f.get_extension().to_lower() in ["glb", "zip"]:
			paths.append(f)
	if paths.is_empty():
		_say("That isn't a model. Drop a folder, a zip or .glb files.", AMBER)
		return
	if paths.size() == 1 and DirAccess.dir_exists_absolute(paths[0]):
		last_folder = paths[0]
		_save_settings()
	_open(paths)


func _on_folder_chosen(dir: String) -> void:
	last_folder = dir
	_save_settings()
	_open([dir])


# ------------------------------------------------------------------ showing models

func _shown() -> Array[Model]:
	var out: Array[Model] = []
	if grid_view:
		for m in models:
			if m.slot:
				out.append(m)
	elif current < models.size() and models[current].slot:
		out.append(models[current])
	return out


func _set_grid(on: bool) -> void:
	grid_view = on
	for m in models:
		if m.slot:
			m.slot.visible = false
	if grid_view:
		_lay_out_grid()
	for m in _shown():
		m.slot.visible = true
		if not grid_view:
			m.slot.position = Vector3.ZERO
	_fit()
	_show_details(null if grid_view else _current_model())
	_sync_controls()


## Rows of models side by side on the floor, in list order, wrapped to a roughly square area.
func _lay_out_grid() -> void:
	var gap := 0.0
	var area := 0.0
	var laid: Array[Model] = []
	for m in models:
		if m.slot:
			laid.append(m)
			gap = maxf(gap, maxf(m.size.x, m.size.z))
			area += (m.size.x + 0.2) * (m.size.z + 0.2)
	gap = clampf(gap * 0.15, 0.1, 0.5)
	var row_width := maxf(sqrt(area) * 1.6, 1.0)
	var x := 0.0
	var z := 0.0
	var row_depth := 0.0
	var placed: Array[Model] = []
	var rows: Array = []
	for m in laid:
		if x > 0.0 and x + m.size.x > row_width:
			rows.append([placed, x - gap])
			placed = []
			z += row_depth + gap * 2.0
			x = 0.0
			row_depth = 0.0
		m.slot.position = Vector3(x + m.size.x / 2.0, 0, z + m.size.z / 2.0)
		x += m.size.x + gap
		row_depth = maxf(row_depth, m.size.z)
		placed.append(m)
	rows.append([placed, x - gap])
	# centre each row
	for r in rows:
		for m in r[0]:
			m.slot.position.x -= r[1] / 2.0
	var depth := z + row_depth
	for m in laid:
		m.slot.position.z -= depth / 2.0


func _current_model() -> Model:
	return models[current] if current < models.size() else null


func _select(i: int) -> void:
	if models.is_empty():
		return
	current = wrapi(i, 0, models.size())
	list.select(current)
	list.ensure_current_is_visible()
	if grid_view:
		return
	for m in models:
		if m.slot:
			m.slot.visible = false
	var m := _current_model()
	if m.slot:
		m.slot.visible = true
		m.slot.position = Vector3.ZERO
	_fit()
	_show_details(m)


func _step(d: int) -> void:
	if grid_view:
		_set_grid(false)
	_select(current + d)


func _show_details(m: Model) -> void:
	if models.is_empty():
		name_label.text = "No models"
		details_label.text = ""
		return
	if m == null:
		name_label.text = "%d models side by side" % _shown().size() if grid_view else ""
		details_label.text = "[color=#%s]Point at a model to see its name, click it to look at it on its own. G or the button goes back.[/color]" % MIST.to_html(false)
		return
	name_label.text = m.name
	if m.error != "":
		details_label.text = "[color=#%s]%s[/color]" % [CHERRY.to_html(false), m.error]
		return
	var have := func(on: bool, what: String) -> String:
		return "[color=#%s]%s %s[/color]" % [(MINT if on else FAINT).to_html(false), "✓" if on else "✗", what]
	var line1 := "%d of %d  ·  %d triangles  ·  texture %d × %d  ·  %.2f × %.2f × %.2f m" % [
		models.find(m) + 1, models.size(), m.triangles, m.texture.x, m.texture.y, m.size.x, m.size.y, m.size.z]
	if not m.unlit:
		line1 += "  ·  metal %s, rough %s" % [snappedf(m.metal, 0.01), snappedf(m.rough, 0.01)]
	var line2 := ""
	if m.unlit:
		line2 = "[color=#%s]Unlit: it ignores light, so it has no surface detail maps (painted-in crevice shadows are part of its colours).[/color]" % SKY.to_html(false)
	else:
		line2 = "In this file:  %s   %s   %s" % [
			have.call(m.has_normal, "bumpy surface"), have.call(m.has_ao, "crevice shadows (AO map)"), have.call(m.has_trims, "shiny trims")]
	details_label.text = "[color=#%s]%s[/color]\n%s" % [MIST.to_html(false), line1, line2]


func _say(text: String, colour: Color) -> void:
	notice.text = text
	notice.add_theme_color_override("font_color", colour)


func _set_light(i: int) -> void:
	light_setup = i
	_apply_light()
	_sync_controls()
	_save_settings()


# ------------------------------------------------------------------ settings

func _load_settings() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(SETTINGS_FILE) != OK:
		return
	use_normal = cfg.get_value("look", "normal", use_normal)
	use_ao = cfg.get_value("look", "ao", use_ao)
	ao_light = cfg.get_value("look", "ao_light", ao_light)
	use_trims = cfg.get_value("look", "trims", use_trims)
	colour_only = cfg.get_value("look", "colour_only", colour_only)
	light_setup = clampi(cfg.get_value("look", "light", light_setup), 0, LIGHTS.size() - 1)
	turntable = cfg.get_value("look", "turntable", turntable)
	show_floor = cfg.get_value("look", "floor", show_floor)
	last_folder = cfg.get_value("files", "last_folder", last_folder)


func _save_settings() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("look", "normal", use_normal)
	cfg.set_value("look", "ao", use_ao)
	cfg.set_value("look", "ao_light", ao_light)
	cfg.set_value("look", "trims", use_trims)
	cfg.set_value("look", "colour_only", colour_only)
	cfg.set_value("look", "light", light_setup)
	cfg.set_value("look", "turntable", turntable)
	cfg.set_value("look", "floor", show_floor)
	cfg.set_value("files", "last_folder", last_folder)
	cfg.save(SETTINGS_FILE)


# ------------------------------------------------------------------ the interface

func _box(bg: Color, radius := 10, pad := 10, border := Color.TRANSPARENT, border_width := 0) -> StyleBoxFlat:
	var b := StyleBoxFlat.new()
	b.bg_color = bg
	b.set_corner_radius_all(radius)
	b.set_content_margin_all(pad)
	if border_width > 0:
		b.border_color = border
		b.set_border_width_all(border_width)
	return b


func _font(file: String, fallback: String, weight: int) -> FontVariation:
	var base: FontFile = load(file)
	base.fallbacks = [load(fallback)]
	var f := FontVariation.new()
	f.base_font = base
	f.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): weight}
	return f


func _make_theme() -> Theme:
	var t := Theme.new()
	var body := _font("res://fonts/nunito-latin.woff2", "res://fonts/nunito-latin-ext.woff2", 650)
	var bold := _font("res://fonts/nunito-latin.woff2", "res://fonts/nunito-latin-ext.woff2", 800)
	var pixel := _font("res://fonts/pixelify-sans-latin.woff2", "res://fonts/pixelify-sans-latin-ext.woff2", 600)
	t.default_font = body
	t.default_font_size = 14

	t.set_stylebox("panel", "PanelContainer", _box(Color(PLUM, 0.94), 14, 12, LINE, 2))
	t.set_color("font_color", "Label", INK)
	t.set_type_variation("Heading", "Label")
	t.set_font("font", "Heading", pixel)
	t.set_font_size("font_size", "Heading", 19)
	t.set_type_variation("Section", "Label")
	t.set_font("font", "Section", bold)
	t.set_font_size("font_size", "Section", 11)
	t.set_color("font_color", "Section", FAINT)
	t.set_type_variation("Hint", "Label")
	t.set_font_size("font_size", "Hint", 12)
	t.set_color("font_color", "Hint", MIST)

	for kind in ["Button", "CheckBox"]:
		t.set_font(&"font", kind, bold)
		t.set_color("font_color", kind, INK)
		t.set_color("font_hover_color", kind, INK)
		t.set_color("font_pressed_color", kind, INK)
		t.set_color("font_hover_pressed_color", kind, INK)
		t.set_color("font_focus_color", kind, INK)
		t.set_color("font_disabled_color", kind, FAINT)
	t.set_stylebox("normal", "Button", _box(HIGHLIGHT, 9, 7))
	t.set_stylebox("hover", "Button", _box(HIGHLIGHT.lightened(0.12), 9, 7))
	t.set_stylebox("pressed", "Button", _box(PERI, 9, 7))
	t.set_stylebox("hover_pressed", "Button", _box(PERI.lightened(0.1), 9, 7))
	t.set_stylebox("disabled", "Button", _box(PLUM_2, 9, 7))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	for s in ["normal", "pressed", "hover_pressed"]:
		t.set_stylebox(s, "CheckBox", _box(Color.TRANSPARENT, 8, 3))
	t.set_stylebox("hover", "CheckBox", _box(PLUM_2, 8, 3))
	t.set_stylebox("focus", "CheckBox", StyleBoxEmpty.new())
	t.set_type_variation("Big", "Button")
	t.set_stylebox("normal", "Big", _box(LIME.darkened(0.35), 10, 8))
	t.set_stylebox("hover", "Big", _box(LIME.darkened(0.25), 10, 8))
	t.set_stylebox("pressed", "Big", _box(LIME.darkened(0.45), 10, 8))

	t.set_stylebox("panel", "ItemList", _box(FIELD, 10, 6))
	t.set_stylebox("focus", "ItemList", StyleBoxEmpty.new())
	t.set_stylebox("selected", "ItemList", _box(PERI, 7, 4))
	t.set_stylebox("selected_focus", "ItemList", _box(PERI, 7, 4))
	t.set_stylebox("hovered", "ItemList", _box(HIGHLIGHT, 7, 4))
	t.set_stylebox("hovered_selected", "ItemList", _box(PERI.lightened(0.1), 7, 4))
	t.set_stylebox("hovered_selected_focus", "ItemList", _box(PERI.lightened(0.1), 7, 4))
	t.set_color("font_color", "ItemList", INK)
	t.set_color("font_selected_color", "ItemList", Color.WHITE)
	t.set_color("font_hovered_color", "ItemList", INK)
	t.set_color("font_hovered_selected_color", "ItemList", Color.WHITE)
	t.set_constant("v_separation", "ItemList", 3)

	t.set_stylebox("slider", "HSlider", _box(FIELD, 4, 3))
	t.set_stylebox("grabber_area", "HSlider", _box(PERI, 4, 3))
	t.set_stylebox("grabber_area_highlight", "HSlider", _box(PERI.lightened(0.1), 4, 3))
	t.set_stylebox("scroll", "VScrollBar", _box(FIELD, 6, 0))
	t.set_stylebox("grabber", "VScrollBar", _box(HIGHLIGHT, 6, 4))
	t.set_stylebox("grabber_highlight", "VScrollBar", _box(LINE, 6, 4))
	t.set_stylebox("grabber_pressed", "VScrollBar", _box(PERI, 6, 4))

	t.set_stylebox("panel", "TooltipPanel", _box(CREAM, 8, 8))
	t.set_color("font_color", "TooltipLabel", GRAPE)
	t.set_font("font", "TooltipLabel", body)
	t.set_font_size("font_size", "TooltipLabel", 13)

	t.set_font("normal_font", "RichTextLabel", body)
	t.set_font_size("normal_font_size", "RichTextLabel", 13)
	t.set_color("default_color", "RichTextLabel", INK)
	return t


func _label(text: String, variation := "") -> Label:
	var l := Label.new()
	l.text = text
	if variation != "":
		l.theme_type_variation = variation
	return l


func _button(text: String, tip: String, pressed: Callable, toggle := false) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.toggle_mode = toggle
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(pressed)
	return b


func _check(key: String, text: String, tip: String, changed: Callable) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.tooltip_text = tip
	c.focus_mode = Control.FOCUS_NONE
	c.toggled.connect(changed)
	checks[key] = c
	return c


func _panel(parent: Control) -> VBoxContainer:
	var p := PanelContainer.new()
	parent.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	p.add_child(v)
	return v


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	ui = Control.new()
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.theme = _make_theme()
	layer.add_child(ui)

	# left: where the models come from, and the list
	var left := _panel(ui)
	var lp := left.get_parent() as Control
	lp.anchor_bottom = 1.0
	lp.offset_left = 12
	lp.offset_top = 12
	lp.offset_right = 272
	lp.offset_bottom = -12
	var title := HBoxContainer.new()
	title.add_theme_constant_override("separation", 8)
	var logo := TextureRect.new()
	logo.texture = load("res://icon.svg")
	logo.custom_minimum_size = Vector2(28, 28)
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	title.add_child(logo)
	title.add_child(_label("Model preview", "Heading"))
	left.add_child(title)
	left.add_child(_label("MODELS FROM", "Section"))
	folder_label = _label("", "Hint")
	folder_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	folder_label.mouse_filter = Control.MOUSE_FILTER_STOP
	folder_label.custom_minimum_size.x = 230
	left.add_child(folder_label)
	var row := HBoxContainer.new()
	row.add_child(_button("Open folder...", "Pick the folder you exported your models to. Sub-folders (\"One folder per model\") and zips in it are loaded too.\nYou can also drop a folder, a zip or .glb files onto this window.", _pick_folder))
	row.get_child(0).theme_type_variation = "Big"
	row.get_child(0).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_button("Reload", "Load the same folder again, after exporting new versions of the models (R).", _reload))
	left.add_child(row)
	list = ItemList.new()
	list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	list.focus_mode = Control.FOCUS_NONE
	list.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	list.item_selected.connect(func(i):
		if grid_view:
			current = i
			_set_grid(false)
		_select(i))
	left.add_child(list)
	left.add_child(_label("Drop a folder, a zip or .glb files\nonto the window to load them.", "Hint"))

	# right: the look
	var right := _panel(ui)
	var rp := right.get_parent() as Control
	rp.anchor_left = 1.0
	rp.anchor_right = 1.0
	rp.offset_left = -284
	rp.offset_right = -12
	rp.offset_top = 12
	rp.offset_bottom = 12
	right.add_child(_label("SHOW", "Section"))
	var views := HBoxContainer.new()
	var group := ButtonGroup.new()
	for i in 2:
		var b := _button(["One model", "All side by side"][i],
			["One model at a time. Flip through them with the arrow keys or the list.", "Every model at once, side by side on the floor (G). Click one to look at it on its own."][i],
			_set_grid.bind(i == 1), true)
		b.button_group = group
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		views.add_child(b)
		view_buttons.append(b)
	right.add_child(views)

	right.add_child(_label("SURFACE DETAIL", "Section"))
	right.add_child(_check("normal", "Bumpy surface (normal map)", "Shows the file's normal map: the carved and embossed look from \"Bumpy surface\" in the app.",
		func(on): use_normal = on; _apply_all_surfaces(); _save_settings()))
	right.add_child(_check("ao", "Crevice shadows (AO map)", "Shows crevice shadows saved \"In the file (AO map)\". Godot uses them to darken sky and ambient light, so they show most in Shade.\nShadows \"Painted into the texture\" are part of the colours and always show.",
		func(on): use_ao = on; _apply_all_surfaces(); _save_settings()))
	var ao_row := HBoxContainer.new()
	var ao_name := _label("   AO on light", "Hint")
	ao_name.tooltip_text = "Godot's \"AO on light\" material setting: how much the crevice shadows also darken direct light (sun and lamps).\n0 is what Godot gives a model you import, so that's what your game shows unless you raise it on the material."
	ao_name.mouse_filter = Control.MOUSE_FILTER_STOP
	ao_row.add_child(ao_name)
	ao_slider = HSlider.new()
	ao_slider.min_value = 0.0
	ao_slider.max_value = 1.0
	ao_slider.step = 0.05
	ao_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ao_slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	ao_slider.focus_mode = Control.FOCUS_NONE
	ao_slider.tooltip_text = ao_name.tooltip_text
	ao_slider.value_changed.connect(func(v):
		ao_light = v
		ao_value.text = "%.2f" % v
		_apply_all_surfaces()
		_save_settings())
	ao_row.add_child(ao_slider)
	ao_value = _label("0.00", "Hint")
	ao_value.custom_minimum_size.x = 34
	ao_row.add_child(ao_value)
	right.add_child(ao_row)
	right.add_child(_check("trims", "Shiny trims", "Shows the file's shiny trims (its roughness and metallic maps). Off, the whole model uses its own Metal and Rough values.",
		func(on): use_trims = on; _apply_all_surfaces(); _save_settings()))
	right.add_child(_check("colour", "Colour only (no lighting)", "Just the colours, with no light or shading at all: what the texture itself holds.",
		func(on): colour_only = on; _apply_all_surfaces(); _save_settings()))

	right.add_child(_label("LIGHT", "Section"))
	var lights := GridContainer.new()
	lights.columns = 2
	var lgroup := ButtonGroup.new()
	for i in LIGHTS.size():
		var b := _button(LIGHTS[i], LIGHT_TIPS[i] + " (%d)" % (i + 1), _set_light.bind(i), true)
		b.button_group = lgroup
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		lights.add_child(b)
		light_buttons.append(b)
	right.add_child(lights)

	right.add_child(_label("CAMERA", "Section"))
	right.add_child(_check("turntable", "Turntable (spin the model)", "Turns the models slowly under the lights (Space), so you see the surface catch the light from every side.",
		func(on): turntable = on; _save_settings()))
	right.add_child(_check("floor", "Floor", "A plain floor under the models, to catch their shadows.",
		func(on): show_floor = on; floor_mesh.visible = on; _save_settings()))
	right.add_child(_button("Reset view", "Back to the starting angle, framing the model (F).", _reset_view))
	right.add_child(_label("Drag: turn the camera\nRight-drag: move  ·  Wheel: zoom\n← →: next model  ·  1–4: lights", "Hint"))

	# bottom: the shown model
	var info := _panel(ui)
	var ip := info.get_parent() as Control
	ip.anchor_top = 1.0
	ip.anchor_bottom = 1.0
	ip.anchor_right = 1.0
	ip.offset_left = 284
	ip.offset_right = -296
	ip.offset_top = -12
	ip.offset_bottom = -12
	ip.grow_vertical = Control.GROW_DIRECTION_BEGIN
	var info_row := HBoxContainer.new()
	info_row.add_theme_constant_override("separation", 10)
	info.add_child(info_row)
	var prev := _button("  <  ", "Previous model (←)", _step.bind(-1))
	prev.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	info_row.add_child(prev)
	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_constant_override("separation", 2)
	name_label = _label("", "Heading")
	name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	text.add_child(name_label)
	details_label = RichTextLabel.new()
	details_label.bbcode_enabled = true
	details_label.fit_content = true
	details_label.scroll_active = false
	details_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text.add_child(details_label)
	info_row.add_child(text)
	var next := _button("  >  ", "Next model (→)", _step.bind(1))
	next.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	info_row.add_child(next)

	# top middle: what just happened
	notice = _label("", "Hint")
	notice.anchor_right = 1.0
	notice.offset_left = 290
	notice.offset_right = -300
	notice.offset_top = 14
	notice.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui.add_child(notice)

	folder_dialog = FileDialog.new()
	folder_dialog.file_mode = FileDialog.FILE_MODE_OPEN_DIR
	folder_dialog.access = FileDialog.ACCESS_FILESYSTEM
	folder_dialog.use_native_dialog = true
	folder_dialog.title = "The folder with your exported models"
	folder_dialog.dir_selected.connect(_on_folder_chosen)
	add_child(folder_dialog)


func _pick_folder() -> void:
	if last_folder != "" and DirAccess.dir_exists_absolute(last_folder):
		folder_dialog.current_dir = last_folder
	folder_dialog.popup_centered_ratio(0.6)


## Puts every control in line with the settings (after loading them or a key press).
func _sync_controls() -> void:
	checks.normal.set_pressed_no_signal(use_normal)
	checks.ao.set_pressed_no_signal(use_ao)
	checks.trims.set_pressed_no_signal(use_trims)
	checks.colour.set_pressed_no_signal(colour_only)
	checks.turntable.set_pressed_no_signal(turntable)
	checks.floor.set_pressed_no_signal(show_floor)
	floor_mesh.visible = show_floor
	ao_slider.set_value_no_signal(ao_light)
	ao_value.text = "%.2f" % ao_light
	for i in view_buttons.size():
		view_buttons[i].set_pressed_no_signal(grid_view == (i == 1))
	for i in light_buttons.size():
		light_buttons[i].set_pressed_no_signal(light_setup == i)
