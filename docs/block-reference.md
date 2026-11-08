# HydraScript - Block Reference

_Generated from `hydra/block-catalog.js` and the editor palette on 2026-11-04. If a block is missing here, the palette is the source of truth._

How to read an event: put a **Condition** block on the grid, then place **Action** blocks next to it (same group, adjacent, or to its right on the same row). When the condition is true, its actions run. The Event Sheet view shows the same logic as rows.

## Core blocks (palette)

| Block | Type | What it does |
|---|---|---|
| Keyboard | Condition | True while a key is held down, on the exact frame it is pressed, or on the exact frame it is released. Can watch any key. |
| Mouse Click | Condition | True for a mouse button state. Supports left, middle, and right click. |
| On Game Start | Condition | Fires once when the preview (or exported game) starts. Use it for setup: set scores, place objects, start music. |
| Collision | Condition | True when two objects overlap. "Count edges touching" also counts objects that are exactly touching (for example a player standing on a floor). |
| Overlap / Touch | Condition | True when two objects are within a touch distance of each other. The tolerance expands the hitbox so resting objects still count. |
| On Screen Edge | Condition | True when an object reaches a canvas boundary (left, right, top, bottom, or any). |
| On Timer | Condition | Fires repeatedly every N seconds. Timers with the same name share the same tick, so name each repeating event. |
| Variable Check | Condition | Compares a game variable against a value. The compare value can be a number or an expression. |
| AND / OR | Condition | Combines the condition blocks next to it: all must be true (AND) or at least one (OR). |
| Apply Force | Action | Pushes an object. Add mode adds to its velocity; Set mode replaces it. X and Y accept numbers or expressions. Positive Y points down. |
| Teleport | Action | Moves an object to an exact X/Y instantly. Coordinates accept expressions like "enemy.posX + 10". |
| Set Variable | Action | Creates or updates a game variable. The value can be a number or an expression such as "score + 10". |
| Random Variable | Action | Sets a variable to a random number between Min and Max. Min and Max accept expressions. |
| Destroy Object | Action | Removes an object from the scene immediately. It cannot collide or be clicked later in the same frame. |
| Show / Hide | Action | Makes an object visible or invisible without deleting it. Hidden objects keep running their logic. |
| Play Sound | Action | Plays a built-in synthesized tone (frequency, duration, waveform) or an uploaded audio asset, through the Music, SFX, or UI bus, with per-sound volume and pitch. Music-bus assets stream (loop by default); SFX/UI assets are decoded once and kept in memory. Works in preview and in exported games. |
| Switch Scene | Action | Changes to another scene. The switch happens at the end of the frame, so the remaining actions in the current event still run against the old scene. |
| Set Text | Action | Sets the content of a text object, or binds it to a variable so it always shows the current value (with optional prefix/suffix). |
| Set Camera | Action | Moves the camera viewport to an X/Y position. World objects shift; UI text stays fixed. Accepts expressions. |
| Follow Camera | Action | Makes the camera follow an object every frame, with an optional offset. |
| Resize Object | Action | Resizes every object with the given name. Width and height accept expressions. |
| Set Velocity | Action | Directly assigns an object's horizontal and vertical velocity. Accepts expressions like "speed * 2". |
| Spawn Clone | Action | Creates a copy of a source object at X/Y. Leave the coordinates blank to spawn at the source's own position. |
| Rotate | Action | Rotates an object by an angle in degrees. Add mode spins it a little each frame (use 1-5 for smooth spin); Set mode snaps to an angle. |
| Force Toward | Action | Moves an object toward a target object or position at a speed. Physics objects with gravity keep falling, and a grounded object gets a jump impulse when the target is above it. |

### Keyboard

True while a key is held down, on the exact frame it is pressed, or on the exact frame it is released. Can watch any key.

**Fields:**

- State: Held down / Pressed this frame / Released this frame
- Any key toggle
- Key to check (key picker)
- Invert

### Mouse Click

True for a mouse button state. Supports left, middle, and right click.

**Fields:**

- Condition: pressed / just pressed / released
- Button: Left / Middle / Right / Any
- Invert

### On Game Start

Fires once when the preview (or exported game) starts. Use it for setup: set scores, place objects, start music.

**Fields:**

- Invert

### Collision

True when two objects overlap. "Count edges touching" also counts objects that are exactly touching (for example a player standing on a floor).

**Fields:**

- Object A
- Object B
- Count edges touching as collision
- Invert

### Overlap / Touch

True when two objects are within a touch distance of each other. The tolerance expands the hitbox so resting objects still count.

**Fields:**

- Object A
- Object B
- Touch distance (px, default 4)
- Invert

### On Screen Edge

True when an object reaches a canvas boundary (left, right, top, bottom, or any).

**Fields:**

- Object
- Edge
- Invert

### On Timer

Fires repeatedly every N seconds. Timers with the same name share the same tick, so name each repeating event.

**Fields:**

- Name
- Seconds
- Invert

### Variable Check

Compares a game variable against a value. The compare value can be a number or an expression.

**Fields:**

- Variable
- Operator (>=, <=, ==, !=, >, <)
- Value (number or expression)
- Invert

### AND / OR

Combines the condition blocks next to it: all must be true (AND) or at least one (OR).

**Fields:**

- Logic: And / Or

### Apply Force

Pushes an object. Add mode adds to its velocity; Set mode replaces it. X and Y accept numbers or expressions. Positive Y points down. It works on any object, physics or not: a plain object glides at a steady speed (no gravity, no friction, no collisions), while a physics object also feels gravity and friction and collides. Text and static objects never move. On the grid, the block's arrow points in the force's direction: right for +X, left for -X, down for +Y, up for -Y, diagonally for a mix. When X or Y holds an expression instead of a number, the arrow stays pointing right.

**Fields:**

- Object (+ target mode)
- X (expression)
- Y (expression)
- Mode: Add / Set

### Teleport

Moves an object to an exact X/Y instantly. Coordinates accept expressions like "enemy.posX + 10".

**Fields:**

- Object (+ target mode)
- X (expression)
- Y (expression)

### Set Variable

Creates or updates a game variable. The value can be a number or an expression such as "score + 10".

**Fields:**

- Variable
- Operation: Set / Add / Subtract / Multiply / Toggle
- Value (number or expression)

### Random Variable

Sets a variable to a random number between Min and Max. Min and Max accept expressions.

**Fields:**

- Variable
- Min (expression)
- Max (expression)
- Round to integer

### Destroy Object

Removes an object from the scene immediately. It cannot collide or be clicked later in the same frame.

**Fields:**

- Object (+ target mode)

### Show / Hide

Makes an object visible or invisible without deleting it. Hidden objects keep running their logic.

**Fields:**

- Object (+ target mode)
- Action: Hide / Show / Toggle

### Play Sound

Plays a built-in synthesized tone (pick frequency, duration, waveform) or an uploaded audio asset from the Assets panel, through one of the three audio buses. Works in preview and in exported games.

**Fields:**

- Sound: Built-in tone / uploaded audio file
- Frequency (Hz), Duration (s), Waveform (tone mode)
- Volume (0-1)
- Bus: Music / SFX / UI (old blocks default to SFX)
- Pitch (0.25-2): 1 is normal, 2 is one octave up, 0.5 one octave down
- Loop (music bus only): on by default for music

Music-bus assets stream through an audio element and are never fully loaded into memory; only one track plays at a time (a new one replaces the old). SFX/UI assets are decoded once and kept memory-resident, so rapid repeats cost nothing. A muted bus (or one at volume 0) plays nothing.

### Play Animation

Plays one of the object's animations from its first frame. Set up the animation list on the object in the Inspector (Animations section); pick the animation by name here. Works in preview and in exported games.

**Fields:**

- Object (+ target mode)
- Animation

### Set Animation

Switches the object to a different animation without restarting the frame counter — use it to swap variants (Walk to WalkHurt) seamlessly. Works in preview and in exported games.

**Fields:**

- Object (+ target mode)
- Animation

### Stop Animation

Stops the object's animation. The object goes back to its static sprite. Works in preview and in exported games.

**Fields:**

- Object (+ target mode)

### Animation Finished

Fires when a play-once animation has finished. Pick a specific animation, or Any animation to catch all of them. Great for chaining attacks, cutscenes, or respawns. Works in preview and in exported games.

**Fields:**

- Object
- Animation (or Any animation)
- Invert toggle

### Set Animation State

Enters one of the object's animation states. The state's animation starts playing automatically at the state's speed. Build the state list on the object in the Inspector (Animation States section): each state names a moment ("Idle", "Run", "Hurt") and binds it to an animation plus a playback speed. Drive transitions from your logic grid — e.g. Every Frame, Action Held "right", then Set Animation State "Run". Works in preview and in exported games.

**Fields:**

- Object (+ target mode)
- State

### Animation State

True while the object is in the chosen animation state. A state read, like a variable check: it evaluates every frame while true (and while paused, since the state is frozen). Invert it to catch "left the state". Works in preview and in exported games.

**Fields:**

- Object
- State
- Invert toggle

### Set Blend

Sets a blend space's X and Y values and activates it. Run it every frame from input values — e.g. X = Action Input "moveX", Y = Action Input "moveY" — and the engine crossfades between the nearest animations in the blend space. Build the blend space on the object in the Inspector (Blend Spaces section): each blend space names a mix ("Move") and places animations at X/Y points (Idle at 0,0; Walk Right at 1,0; Walk Left at -1,0...). Works in preview and in exported games.

**Fields:**

- Object (+ target mode)
- Blend
- X (an expression, like `moveX`)
- Y (an expression, like `moveY`)

### Stop Blend

Stops the object's active blend space. The object goes back to its normal animation. Leave Blend empty to stop whichever blend is active. Works in preview and in exported games.

**Fields:**

- Object (+ target mode)
- Blend

### Blend Active

True while the object's chosen blend space is active. A blend read, like a variable check: it evaluates every frame while true (and while paused, since the blend is frozen). Invert it to catch "blend stopped". Works in preview and in exported games.

**Fields:**

- Object
- Blend
- Invert toggle

### Tween

Animates one of the object's numeric properties (X/Y position, width, height, rotation, opacity) from its current value to a target value over a number of seconds, following an easing curve. Pick a preset (Move right 100, Fade out, Spin 360 degrees, Shake...) or set the fields yourself. A new Tween on the same property replaces the old one, so tweens never fight each other. Works in preview and in exported games.

**Fields:**

- Object (+ target mode)
- Preset
- Property
- To value (an expression, like `100` or `hero.posX + 200`)
- Relative toggle (add the To value to the starting value)
- Duration (seconds)
- Easing (Linear, Ease in, Ease out, Ease in-out, Pop, Bounce)
- Repeat (Once, Loop, Ping-pong)

### Stop Tween

Stops the object's running tween(s): one property, or all of them. The property stays where it is. Works in preview and in exported games.

**Fields:**

- Object (+ target mode)
- Tweens to stop (All tweens, or one property)

### Tween Finished

Fires when a one-shot tween finishes. Pick a property, or Any property to catch all of them. Looping and ping-pong tweens never finish, so they never fire this. Great for chaining pickups, cutscenes, or respawns off a finished motion. Works in preview and in exported games.

**Fields:**

- Object
- Tween (a property, or Any property)
- Invert toggle

### Switch Scene

Changes to another scene. The switch happens at the end of the frame, so the remaining actions in the current event still run against the old scene.

**Fields:**

- Switch to Scene

### Set Text

Sets the content of a text object, or binds it to a variable so it always shows the current value (with optional prefix/suffix).

**Fields:**

- Text object (+ target mode)
- Use variable toggle
- Value or Variable + Prefix + Suffix

### Set Camera

Moves the camera viewport to an X/Y position. World objects shift; UI text stays fixed. Accepts expressions.

**Fields:**

- X (expression)
- Y (expression)

### Follow Camera

Makes the camera follow an object every frame, with an optional offset.

**Fields:**

- Object
- Offset X (expression)
- Offset Y (expression)

### Resize Object

Resizes every object with the given name. Width and height accept expressions.

**Fields:**

- Object (+ target mode)
- Width (expression)
- Height (expression)

### Set Velocity

Directly assigns an object's horizontal and vertical velocity. Accepts expressions like "speed * 2". It works on any object, physics or not: a plain object glides at a steady speed (no gravity, no friction, no collisions), while a physics object also feels gravity and friction and collides. Text and static objects never move.

**Fields:**

- Object (+ target mode)
- X (expression)
- Y (expression)

### Spawn Clone

Creates a copy of a source object at X/Y. Leave the coordinates blank to spawn at the source's own position.

**Fields:**

- Source object
- X (expression, blank = source X)
- Y (expression, blank = source Y)

### Rotate

Rotates an object by an angle in degrees. Add mode spins it a little each frame (use 1-5 for smooth spin); Set mode snaps to an angle.

**Fields:**

- Object (+ target mode)
- Angle (expression)
- Mode: Add / Set

### Force Toward

Moves an object toward a target object or position at a speed. Physics objects with gravity keep falling, and a grounded object gets a jump impulse when the target is above it.

**Fields:**

- Object (+ target mode)
- Toward: object or position
- Speed (expression)
- Mode

## Catalog blocks

Extra blocks from the declarative catalog (movement presets, physics, visual effects, game flow, variables, and more). They work exactly like core blocks: conditions on the left, actions next to them.

### 3D (17)

| Block | Type | What it does |
|---|---|---|
| Move 3D | Action | Moves a 3D object by dX/dY/dZ. |
| Set 3D Position | Action | Teleports the center of a 3D object to X/Y/Z. |
| Set 3D Rotation | Action | Sets the absolute 3D rotation in degrees. |
| Rotate 3D | Action | Adds degrees to a 3D object's rotation. |
| Set Model Tint | Action | Tints a 3D model's material colors with a color. |
| Use Model Texture | Action | Switches a 3D model's texture on or off. |
| Set 3D Camera | Action | Moves the 3D camera and aims it at a look-at point. |
| Follow 3D Object | Action | The 3D camera rides an object's center every frame, looking at it. |
| Stop 3D Camera Follow | Action | Ends the 3D camera follow; the camera holds its position. |
| Aim 3D Camera | Action | Aims the 3D camera from yaw/pitch degrees without moving it (FPS mouse-look). |
| Move 3D Facing | Action | Moves a 3D object along its yaw heading (WASD-style). |
| Set 3D Gravity | Action | Gives a 3D object gravity — it falls downward every frame. |
| Set 3D Velocity | Action | Sets a 3D object's velocity (X/Y/Z) directly. |
| 3D Distance | Condition | True while two objects' 3D center distance matches the comparison. |
| 3D On Ground | Condition | True while a 3D object rests on a solid 3D surface. |
| 3D Collision | Condition | True while two 3D objects' colliders overlap. |
| Set 3D Light | Action | Changes a light's type, color, intensity, range, or on/off at runtime. |

#### Move 3D

Moves the 3D object by the given amounts: dX right, dY down (like the 2D canvas), dZ toward the viewer. Chain it after an Every Frame block for smooth 3D motion.

**Fields:**

- **Object**
- **dX**
- **dY**
- **dZ (toward viewer)**

#### Set 3D Position

Teleports the CENTER of the 3D object to X/Y/Z. Y grows down like the 2D canvas; Z 0 is the screen plane and positive Z comes toward the viewer.

**Fields:**

- **Object**
- **X (center)**
- **Y (center)**
- **Z (toward viewer)**

#### Set 3D Rotation

Sets the absolute rotation of the 3D object in degrees, about its center. Rot X tips it forward/back, Rot Y spins it like a turntable, Rot Z rolls it like a 2D rotation.

**Fields:**

- **Object**
- **Rot X (degrees)**
- **Rot Y (degrees)**
- **Rot Z (degrees)**

#### Rotate 3D

Adds degrees to the 3D object's rotation. Chain it after an Every Frame block (Rot Y 2) for a smooth turntable spin — the classic 3D showcase.

**Fields:**

- **Object**
- **Rot X (degrees)**
- **Rot Y (degrees)**
- **Rot Z (degrees)**

#### Set Model Tint

Tints the 3D model's material colors with the picked color — white means no tint, so the model shows its own colors. Flash a model red when it takes a hit, or fade it blue underwater. Also tints 3D primitives.

**Fields:**

- **Object**
- **Tint color**

#### Use Model Texture

Switches a 3D model's texture on or off at runtime. On shows the model's own skin (textures come with the .glb upload); Off shows its flat material colors instead. Has no effect on models without textures.

**Fields:**

- **Object**
- **Texture**

#### Set 3D Camera

Moves the 3D camera and aims it at the look-at point. The default camera already frames the whole scene — use this for dramatic angles and fly-bys. It also ends any Follow 3D Object in progress.

**Fields:**

- **Camera X**
- **Camera Y**
- **Camera Z**
- **Look X**
- **Look Y**
- **Look Z**

#### Follow 3D Object

The 3D camera rides the object's center every frame, always looking at it — the classic third-person chase view. Offset X moves the camera right, Offset Y down (negative = above), Offset Z toward the viewer. Set 3D Camera or Stop 3D Camera Follow ends the follow.

**Fields:**

- **Object**
- **Offset X (right)**
- **Offset Y (down)**
- **Offset Z (toward viewer)**

#### Stop 3D Camera Follow

Stops the 3D camera follow started by Follow 3D Object — the camera stays exactly where it is. (Set 3D Camera also ends a follow.)

**Fields:**

(none)

#### Aim 3D Camera

Aims the 3D camera from where it already is, using yaw/pitch degrees — the mouse-look half of an FPS camera. Yaw 0 faces into the screen; positive yaw turns right. Pitch 0 is level; positive pitch looks down. Unlike Set 3D Camera this never ends a Follow 3D Object, so park the camera on the player's head with Follow 3D Object and aim it every frame.

**Fields:**

- **Yaw (degrees)**
- **Pitch (degrees)**
- **Look distance**

#### Move 3D Facing

Moves the 3D object along the direction it faces: Forward steps toward the yaw heading, Strafe steps right (negative = left). Yaw 0 is into the screen; positive yaw turns right — the same yaw you steer with Aim 3D Camera, so WASD movement and mouse-look always agree.

**Fields:**

- **Object**
- **Forward**
- **Strafe (right +)**
- **Yaw (degrees)**

#### Set 3D Gravity

Gives the 3D object gravity — it falls downward every frame, exactly like the 2D Set Gravity block. Positive pulls down. Also turns physics on for the object, and writes the same value the Inspector's Physics panel shows, so they never disagree.

**Fields:**

- **Object**
- **Gravity (down +)**

#### Set 3D Velocity

Sets the 3D object's velocity directly: a negative VY launches it upward (jump), zeros stop it dead. Combine with 3D On Ground for jump-only-when-landed, the classic platformer move.

**Fields:**

- **Object**
- **VX (right +)**
- **VY (down +)**
- **VZ (toward viewer +)**

#### 3D Distance

Compares the center-to-center 3D distance between two objects (X, Y, and Z all count). The 3D version of Distance Check — great for 3D pickups and proximity triggers.

**Fields:**

- **Object A**
- **Object B**
- **Operator**
- **Distance**
- **Invert** (On/Off)

#### 3D On Ground

True while the 3D object is resting on a solid 3D surface. The 3D version of On Floor — the classic use is a jump button that only works while the player is grounded (chain 3D On Ground + Action Input into Set 3D Velocity).

**Fields:**

- **Object**
- **Invert** (On/Off)

#### 3D Collision

True while the two 3D objects' colliders overlap — box or sphere colliders, whichever each object uses. The 3D version of the Collision condition; it only reports the touch, it never moves anything.

**Fields:**

- **Object A**
- **Object B**
- **Invert** (On/Off)

#### Set 3D Light

Changes a Light 3D object while the game runs: its type, color, intensity, range, or on/off. Only objects created with the Create palette's Light button are lights — naming anything else warns and skips. Bad colors, intensities, ranges, or types warn and keep the old values; a blank light name stays quiet.

**Fields:**

- **Light**
- **Type** (Point / Directional / Ambient)
- **Color**
- **Intensity**
- **Range**
- **Light** (On/Off)

### Audio (9)

| Block | Type | What it does |
|---|---|---|
| Set Bus Volume | Action | Changes an audio bus volume while the game runs. |
| Set Bus Muted | Action | Mutes or unmutes an audio bus while the game runs. |
| Set Master Volume | Action | Sets the master fader that scales every bus at once. |
| Stop Music | Action | Stops the track currently streaming on the Music bus. |
| Pause Music | Action | Pauses the streaming music track, keeping its position. |
| Resume Music | Action | Continues a paused music track from where it stopped. |
| Stop All Sounds | Action | Stops the music track plus every still-ringing SFX and UI sound. |
| Music Playing | Condition | True while a music track is streaming on the Music bus. |
| Play Sound at Position | Action | Plays a tone or an uploaded sound from a place in the world, fading with distance and panning left/right. |

#### Set Bus Volume

Changes an audio bus volume while the game runs — fade the music out before a boss fight, duck the SFX in a menu. The Audio tab sets the starting volumes.

**Fields:**

- **Bus** (options: Music, SFX, UI)
- **Volume (0-1)**

#### Set Bus Muted

Mutes or unmutes an audio bus while the game runs — the building block for a settings-menu mute toggle.

**Fields:**

- **Bus** (options: Music, SFX, UI)
- **Muted** (options: Muted, Unmuted)

#### Set Master Volume

Sets the master fader that scales every bus at once — the single volume control for a settings menu. The Audio tab sets the starting level; per-bus volumes still apply underneath.

**Fields:**

- **Volume (0-1)**

#### Stop Music

Stops the track currently streaming on the Music bus. Playing a new track on the Music bus also replaces the old one.

**Fields:**

None.

#### Pause Music

Pauses the streaming music track, keeping its position — resume it with Resume Music. A music track played as a built-in tone (no audio file) cannot pause, so keep a tone track playing.

**Fields:**

None.

#### Resume Music

Continues a paused music track from where it stopped. Does nothing when no music is paused.

**Fields:**

None.

#### Stop All Sounds

Stops everything currently playing — the music track plus every SFX and UI sound still ringing out. The cutscene / scene-change silencer.

**Fields:**

None.

#### Music Playing

True while a music track is streaming on the Music bus (false when paused, stopped, or finished). Invert it to detect "the song ended" and start the next one.

**Fields:**

- **Invert** (options: Off, On)

#### Play Sound at Position

Plays a built-in synthesized tone (pick frequency, duration, waveform) or an uploaded audio asset from a place in the world — at an object, or at the X/Y point when no object is named. The listener is the center of the screen: the sound is full volume on top of it, fades linearly to silent at the hear-within distance, and pans left or right with the source. Past the hear-within distance nothing plays at all. A failed distance or position number warns and plays nothing; a missing object stays quiet. Works in preview and in exported games. Honest limits: linear falloff only; the listener is always the screen center; a streamed track (a Music-bus asset, or any asset the runtime falls back to an audio element for) gets the distance volume but no stereo pan.

**Fields:**

- **Sound** (options: Built-in tone, or an uploaded audio asset)
- **Frequency (Hz)**
- **Duration (s)**
- **Waveform** (options: Square, Sine, Sawtooth, Triangle)
- **At object**
- **X (no object)**
- **Y (no object)**
- **Hear within (px)**
- **Volume (0-1)**
- **Bus** (options: Music, SFX, UI)
- **Pitch (0.25-2)**

### Tilemap (3)

| Block | Type | What it does |
|---|---|---|
| Set Tile | Action | Paints one cell of a tilemap while the game runs. |
| Tile Solid At | Condition | True when the tile at a world position is solid. |
| Standing On Tile | Condition | True when an object stands on a solid tile of the tilemap. |

#### Set Tile

Paints one cell of a tilemap while the game runs — build or destroy terrain, open doors, crumble platforms. Use -1 to clear a cell.

**Fields:**

- **Tilemap** (object)
- **Column**
- **Row**
- **Tile (-1 clears)**

#### Tile Solid At

True when the tile at the world position (X, Y) is solid — check what is ahead of the player before they get there.

**Fields:**

- **Tilemap** (object)
- **X (world)**
- **Y (world)**
- **Invert** (On/Off)

#### Standing On Tile

True when the object stands on a solid tile of the tilemap — the tile-aware grounded check for platformer jump logic.

**Fields:**

- **Object**
- **Tilemap** (object)
- **Invert** (On/Off)

### Camera (14)

| Block | Type | What it does |
|---|---|---|
| Screen Shake | Action |  |
| Screen Flash | Action | Flashes the whole screen a color briefly, for hits, pickups, or scene changes |
| Move Camera | Action | Sets the world position shown at the top-left of the screen |
| Center Camera On | Action | One shot: centers the camera on an object right now |
| Follow Object | Action | The camera tracks an object every frame until stopped |
| Stop Camera Follow | Action | The camera stops following and stays where it is |
| Reset Camera | Action | Stops following, sets zoom back to 1, moves to the world corner |
| Set Camera Zoom | Action | Scales the world render; 1 is normal, 2 zooms in |
| Camera Position | Condition | True when the camera position or zoom matches the comparison |
| Set Camera Smoothing | Action | How gently the camera chases the followed object |
| Set Camera Deadzone | Action | A rectangle around the screen center where the followed object can move without moving the camera |
| Set Camera Bounds | Action | A world rectangle the camera view stays inside |
| Clear Camera Bounds | Action | Removes the camera bounds, so the view goes back to the scene edges |
| Camera Following | Condition | True while the camera is following an object |
| Set Parallax | Action | How fast an object scrolls with the camera: 1 is world speed, 0 is pinned to the screen |
| Parallax Factor | Condition | True when an object's parallax factor matches the comparison |

#### Screen Shake

No description yet.

**Fields:**

- **Strength** - e.g. 6
- **Seconds** - e.g. 0.2
- **Cooldown** - e.g. 0.25

#### Screen Flash

Flashes the whole screen a color briefly, for hits, pickups, or scene changes. Color sets the flash color, Intensity (0-1) sets how strong it looks, Duration sets how long it lasts. The wash fades from full intensity to transparent, draws above the HUD, and freezes while the game is paused. Works in preview and in exported games.

**Fields:**

- **Color**
- **Intensity** - e.g. 0.6
- **Seconds** - e.g. 0.2

#### Move Camera

Sets the world position shown at the top-left of the screen. Clears any camera follow.

**Fields:**

- **X** - e.g. 0 or player.posX - 400
- **Y** - e.g. 0 or player.posY - 300

#### Center Camera On

One shot: centers the camera on the object right now. Does not keep following it.

**Fields:**

- **Object** (object picker)
- **Offset X** - e.g. 0
- **Offset Y** - e.g. 0

#### Follow Object

The camera tracks the object every frame until you stop it.

**Fields:**

- **Object** (object picker)
- **Offset X** - e.g. 0
- **Offset Y** - e.g. 0

#### Stop Camera Follow

The camera stops following and stays where it is.

#### Reset Camera

Stops following, sets zoom back to 1, and moves the camera to the top-left of the world.

#### Set Camera Zoom

1 is normal. 2 zooms in (things look twice as big); 0.5 zooms out. Clamped to 0.25-4.

**Fields:**

- **Zoom** - e.g. 1

#### Camera Position

True when the camera position or zoom matches the comparison.

**Fields:**

- **Property** (Camera X / Camera Y / Zoom)
- **Compare** (at least / at most / equals / not equals / greater than / less than)
- **Value** - e.g. 0
- **Invert** (On/Off)

#### Set Camera Smoothing

How gently the camera chases the followed object. 0 snaps at once (the old behavior); 0.5 glides halfway there each frame; 0.9 is a slow cinematic drift. A bad number warns and the smoothing stays put. The smoothing follows the time scale, so a smoothed follow slows with the world.

**Fields:**

- **Smoothing** - e.g. 0.5

#### Set Camera Deadzone

A width x height rectangle (world pixels) around the center of the screen. While the followed object stays inside it the camera does not move, so small hops and idle sways never shake the view; when the object steps out, the camera moves just enough to bring it back to the edge. 0 x 0 turns the deadzone off.

**Fields:**

- **Width** - e.g. 160
- **Height** - e.g. 100

#### Set Camera Bounds

A world rectangle the camera view stays inside, so the camera never shows past the edge of a room. Min must be below Max on both axes; a bad rectangle warns and the bounds stay put. Clear Camera Bounds removes them, and the view goes back to staying inside the scene edges.

**Fields:**

- **Min X** - e.g. 0
- **Min Y** - e.g. 0
- **Max X** - e.g. 800
- **Max Y** - e.g. 600

#### Clear Camera Bounds

Removes the camera bounds, so the view goes back to staying inside the scene edges.

**Fields:**

(none)

#### Camera Following

True while the camera is following an object. Invert it to detect that the camera is free and park it somewhere with Move Camera.

**Fields:**

- **Invert** (On/Off)

#### Set Parallax

How fast this object scrolls with the camera. 1 moves with the world; 0 stays pinned to the screen, like a sky; 0.5 moves at half speed, like distant hills; above 1 rushes past, like a foreground. A bad number warns and the factors stay put. Drawing only — physics and collision still use the world position, so keep parallax on decoration layers.

**Fields:**

- **Object**
- **Parallax X** - e.g. 0.5
- **Parallax Y** - e.g. 0.5

#### Parallax Factor

True when an object's parallax factor matches the comparison — use it to check a layer is set up the way you meant before the camera starts moving.

**Fields:**

- **Object**
- **Axis** (X (horizontal) / Y (vertical))
- **Compare** (at least / at most / equals / not equals / greater than / less than)
- **Value** - e.g. 0.5
- **Invert** (On/Off)

### Collision (11)

| Block | Type | What it does |
|---|---|---|
| Is On Floor | Condition |  |
| Separate Objects | Action |  |
| Trigger Enter | Condition | Fires once, on the first frame the object starts touching a trigger zone. |
| Trigger Exit | Condition | Fires once, on the first frame the object stops touching a trigger zone. |
| Raycast Hit | Condition | True when an invisible line from one point to another hits any collider. |
| Objects Overlapping | Condition | True when any collider overlaps a circle you describe. |
| Set Collision Layer | Action | Moves an object to a collision layer at runtime. |
| Angle Between | Condition | True when the angle from one object to another matches the comparison. |
| Line of Sight | Condition | True when no collider blocks the straight line between two objects. |
| Distance To Nearest | Condition | True when the closest object in a group is within the compared distance. |
| Moving Towards | Condition | True when an object is moving toward another object. |

#### Is On Floor

No description yet.

**Fields:**

- **Object**
- **Floor**
- **Count touching edges**
- **Invert** (options: Off, On)

#### Separate Objects

No description yet.

**Fields:**

- **Object A**
- **Object B**
- **Move** (options: Object A, Object B, Both)

#### Trigger Enter

Fires once, on the first frame the object starts touching a trigger zone — collect coins, open doors, start a cutscene. The zone must be a trigger collider (Inspector, **Collision** section); triggers never block movement.

**Fields:**

- **Trigger zone** (object)
- **Object**
- **Invert** (On/Off)

#### Trigger Exit

Fires once, on the first frame the object stops touching a trigger zone — leaving a safe area, walking out of a light cone.

**Fields:**

- **Trigger zone** (object)
- **Object**
- **Invert** (On/Off)

#### Raycast Hit

Shoots an invisible line and answers whether it hits any collider — line of sight, laser guns, "is there ground below me?". Reports the closest hit.

**Fields:**

- **From X** (expression)
- **From Y** (expression)
- **To X** (expression)
- **To Y** (expression)
- **Layers (mask)** (expression, 255 = all layers)
- **Invert** (On/Off)

#### Objects Overlapping

True when any collider overlaps the circle — explosion blast radius, pickup magnets, proximity checks.

**Fields:**

- **Center X** (expression)
- **Center Y** (expression)
- **Radius** (expression)
- **Layers (mask)** (expression, 255 = all layers)
- **Invert** (On/Off)

#### Set Collision Layer

Moves an object to a collision layer at runtime — ghost power-ups that pass through walls, team-based friendly fire.

**Fields:**

- **Object**
- **Layer** (expression, 0-7)
- **Collides with (mask)** (expression, 255 = all layers)

#### Angle Between

Angle in degrees from the first object to the second (0 = right, 90 = down, -90 = up). Turret aiming, "is the enemy behind me?".

**Fields:**

- **From object** (object)
- **To object** (object)
- **Compare** (at least, at most, equals, not equals, greater than, less than)
- **Degrees** (expression)
- **Invert** (On/Off)

#### Line of Sight

True when no collider blocks the straight line between the two objects — enemy vision cones, "can the guard see me?". The two objects' own colliders are ignored; anything else on the chosen layers blocks the view.

**Fields:**

- **From object** (object)
- **To object** (object)
- **Layers (mask)** (expression, 255 = all layers)
- **Invert** (On/Off)

#### Distance To Nearest

Distance from the object to the closest object with the named group — enemy AI aggro range, nearest-coin highlight. False when none exist.

**Fields:**

- **Object** (object)
- **Nearest** (object)
- **Compare** (at least, at most, equals, not equals, greater than, less than)
- **Distance** (expression)
- **Invert** (On/Off)

#### Moving Towards

True when the object is moving toward the other — chasing enemies, homing missiles, "am I approaching the landing pad?". A stationary object never counts as moving toward anything.

**Fields:**

- **Object** (object)
- **Towards** (object)
- **Min speed** (expression)
- **Invert** (On/Off)

### Game Flow (10)

| Block | Type | What it does |
|---|---|---|
| Pause Game | Action | Freezes the game world (physics, animations, tweens, camera, timers); the game keeps drawing and buttons still work |
| Resume Game | Action | Unfreezes the game world exactly where it paused |
| Toggle Pause | Action | Pauses if running, resumes if paused |
| Game Paused | Condition | True while the game is paused |
| Timer Elapsed | Condition | True while a named timer's elapsed time compares against the seconds you enter |
| Read Timer | Action | Copies a named timer's elapsed seconds into a game variable |
| Show Profiler | Action | Shows the profiling overlay (FPS, frame time, draw counts) |
| Hide Profiler | Action | Hides the profiling overlay |
| Toggle Profiler | Action | Shows the overlay if hidden, hides it if shown |
| Profiler Visible | Condition | True while the profiling overlay is on screen |

#### Pause Game

Freezes the game world: objects stop moving, animations and timers stop, but the game keeps drawing and buttons still work. Show your pause menu right after it.

#### Resume Game

Unfreezes the game world exactly where it paused. Put it on your Resume button: Object Clicked → Resume Game, then hide the pause menu.

#### Toggle Pause

Pauses if running, resumes if paused — one block for a pause key. Pair it with Game Paused to show or hide the menu.

#### Game Paused

True while the game is paused. Use it to show the pause menu, and invert it to gate gameplay actions so they only run while unpaused.

**Fields:**

- **Invert** - Off / On

#### Timer Elapsed

True while the named timer's elapsed time compares against the seconds you enter. The timer holds its elapsed time while the game is paused, and a timer that was never started reads as 0 seconds. Pair it with Reset / Pause Timer: reset the timer when a wave starts, then fire the boss when Timer Elapsed reaches 30.

**Fields:**

- **Timer name** - e.g. spawnTimer
- **Compare** - At least (elapsed >=) / At most (elapsed <=) / Exactly (elapsed ==) / Not (elapsed !=) / More than (elapsed >) / Less than (elapsed <)
- **Seconds** - e.g. 5 or waveDelay
- **Invert** - Off / On

#### Read Timer

Copies the named timer's elapsed seconds into a game variable, so you can show a countdown, compare times, or do math with them. A timer that was never started reads as 0.

**Fields:**

- **Timer name** - e.g. spawnTimer
- **Into variable** - e.g. elapsed

#### Show Profiler

Shows the profiling overlay: FPS, frame time, and how many sprites, 3D triangles, particles, and objects the game drew this frame. Use it while playtesting to spot slow scenes. You can also flip the overlay from the Preview tab's Profiler button without adding blocks.

#### Hide Profiler

Hides the profiling overlay again. Your players never need to see it, so turn it off before you share the game.

#### Toggle Profiler

Shows the overlay if hidden, hides it if shown — one block for a debug key. Pair it with Key Just Pressed so F3 flips the overlay on and off.

#### Profiler Visible

True while the profiling overlay is on screen. Invert it to run debug actions only while the overlay is hidden.

**Fields:**

- **Invert** - Off / On

### Code (2)

| Block | Type | What it does |
|---|---|---|
| Run Script | Action | Runs your own JavaScript with the hs scripting API |
| Script Check | Condition | True when your JavaScript reads as true |

#### Run Script

Runs your own JavaScript with the `hs` scripting API, the power-user shortcut for logic that would take many blocks. Examples: `hs.obj('hero').move(3, 0);`, `hs.set('score', hs.get('score') + 1);`, `hs.play('coin');`. The full API is in the user guide under "Text scripting". Errors show in the diagnostics panel and never break the game. Only open projects with scripts from people you trust. Script code runs as real JavaScript.

**Fields:**

- **JavaScript code** - your script, e.g. hs.obj('hero').move(3, 0);

#### Script Check

True when your JavaScript reads as true. Write an expression like `hs.get('score') > 10`, or full statements with a `return`. Fires once when it becomes true. Flip the Trigger dropdown to "While true (every frame)" to run the chained actions every frame. Errors read as false and show in the diagnostics panel. Only open projects with scripts from people you trust. Script code runs as real JavaScript.

**Fields:**

- **JavaScript (true/false)** - e.g. hs.get('score') > 10
- **Invert** - Off / On

### Game Flow Presets (10)

| Block | Type | What it does |
|---|---|---|
| Big screen shake | Action |  |
| Camera follows object | Action |  |
| Camera to origin | Action |  |
| Load score | Action |  |
| Pause spawn timer | Action |  |
| Red damage flash | Action |  |
| Reset spawn timer | Action |  |
| Save score | Action |  |
| Small screen shake | Action |  |
| White screen flash | Action |  |

#### Big screen shake

No description yet.

#### Camera follows object

No description yet.

**Fields:**

- **Object**

#### Camera to origin

No description yet.

#### Load score

No description yet.

#### Pause spawn timer

No description yet.

#### Red damage flash

Flashes the screen red briefly, for taking damage.

#### Reset spawn timer

No description yet.

#### Save score

No description yet.

#### Small screen shake

No description yet.

#### White screen flash

Flashes the screen white briefly, for a pickup or scene change.

### Input (19)

| Block | Type | What it does |
|---|---|---|
| Object Clicked | Condition |  |
| Action Input | Condition | Reads a named input action from the Inputs tab. |
| Remap Action | Action | Changes the keyboard binding of a named action while the game runs. |
| Reset Action Bindings | Action | Restores every input action to its configured bindings. |
| Cursor Position | Condition | True when the mouse cursor position (in screen pixels) matches the comparison. |
| Capture Mouse | Action | Locks the mouse pointer to the game (pointer lock) for FPS-style mouse-look. |
| Release Mouse | Action | Releases the captured mouse pointer for menus. |
| Read Mouse Delta | Action | Copies this frame's mouse movement into two game variables. |
| Mouse Pointer Captured | Condition | True while the mouse pointer is captured by Capture Mouse. |
| Any Key Pressed | Condition | True while any keyboard key is held down. |
| Touch Active | Condition | True while at least one finger is touching the game. |
| Touch Count | Condition | True when the number of fingers touching the game matches the comparison. |
| Gamepad Connected | Condition | True when at least one gamepad is connected. |
| Gamepad Button | Condition | Reads a raw gamepad button without going through the Inputs tab. |
| Gamepad Stick | Condition | True when an analog stick axis matches the comparison. |
| Enable Joystick | Action | Turns the on-screen joystick on for the rest of the run. |
| Disable Joystick | Action | Turns the on-screen joystick off at once. |
| Joystick Active | Condition | True while the player is steering with the on-screen joystick. |
| Joystick Tilt | Condition | True while the on-screen joystick tilts the picked way past the minimum tilt. |

#### Object Clicked

No description yet.

**Fields:**

- **Object**
- **Button** (options: Left button, Middle button, Right button)
- **Invert** (options: Off, On)

#### Action Input

Reads a named input action from the Inputs tab. One action can bind keyboard keys, a gamepad button, and a touch zone — so the same logic works on keyboard, gamepad, and touchscreen.

**Fields:**

- **Action**
- **When** (options: Held, Just pressed, Released)
- **Invert** (options: Off, On)

#### Remap Action

Changes the keyboard binding of a named action while the game runs — the building block for a settings / controls menu. Use Reset Action Bindings to restore the defaults.

**Fields:**

- **Action**
- **New key**

#### Reset Action Bindings

Restores every input action to the key, gamepad, and touch bindings set in the Inputs tab.

**Fields:**

None.

#### Cursor Position

True when the mouse cursor position (in screen pixels) matches the comparison. Use it for cursor zones, screen edges, and aim-like checks without an object.

**Fields:**

- **Property** (options: Cursor X, Cursor Y)
- **Compare** (options: at least, at most, equals, not equals, greater than, less than)
- **Value**
- **Invert** (options: Off, On)

#### Capture Mouse

Locks the mouse pointer to the game (pointer lock) for FPS-style mouse-look: the cursor hides and mouse movement turns into deltas instead of screen position. Browsers only allow this from a real click, so run it from an Object Clicked or Mouse Click block — a "Click to play" button is the classic setup. Pressing Esc always releases the pointer.

**Fields:**

(none)

#### Release Mouse

Releases the mouse pointer captured by Capture Mouse, so the cursor comes back for menus. (The player can also press Esc any time.)

**Fields:**

(none)

#### Read Mouse Delta

Copies this frame's mouse movement into two game variables — how far the mouse moved right (dX) and down (dY) since the last frame. While the pointer is captured this is raw mouse motion; otherwise it is cursor travel. Chain it after Every Frame, then steer a yaw variable: yaw = yaw + mdx * 0.25.

**Fields:**

- **Into variable (dX)**
- **Into variable (dY)**

#### Mouse Pointer Captured

True while the mouse pointer is captured by Capture Mouse. Invert it to detect the player pressing Esc — the moment to show the pause menu and offer a "Click to resume" button.

**Fields:**

- **Invert** (options: Off, On)

#### Any Key Pressed

True while any keyboard key is held down. Invert it for "no key is pressed" — handy for attract-mode timers and "press any key to start".

**Fields:**

- **Invert** (options: Off, On)

#### Touch Active

True while at least one finger is touching the game. On desktop with no touchscreen it never fires; invert it for "no finger is down".

**Fields:**

- **Invert** (options: Off, On)

#### Touch Count

True when the number of fingers touching the game matches the comparison. Use 2 for two-finger gestures like pinch or a second player.

**Fields:**

- **Compare** (options: at least, at most, equals, not equals, greater than, less than)
- **Fingers**
- **Invert** (options: Off, On)

#### Gamepad Connected

True when at least one gamepad is connected. Browsers ask the player for permission the first time a game reads a gamepad, so this usually fires after the player presses a button once.

**Fields:**

- **Invert** (options: Off, On)

#### Gamepad Button

Reads a raw gamepad button without going through the Inputs tab. For the shared keyboard/gamepad/touch path, use Action Input with a named action instead.

**Fields:**

- **Button** (options: A / Cross, B / Circle, X / Square, Y / Triangle, Left bumper (LB), Right bumper (RB), Left trigger (LT), Right trigger (RT), Back / Select, Start, Left stick click, Right stick click, D-pad up, D-pad down, D-pad left, D-pad right)
- **When** (options: Held, Just pressed, Released)
- **Invert** (options: Off, On)

#### Gamepad Stick

True when an analog stick axis matches the comparison (values run -1 to 1, 0 is centered). The default 0.2 ignores stick drift; compare against -0.2 with "less than" to read the other direction.

**Fields:**

- **Stick** (options: Left stick, Right stick)
- **Axis** (options: X axis (left/right), Y axis (up/down))
- **Compare** (options: at least, at most, equals, not equals, greater than, less than)
- **Value**
- **Invert** (options: Off, On)

#### Enable Joystick

Turns the on-screen joystick on for the rest of the run: the base circle appears in its corner and a finger (or a mouse drag) can grab it to steer. Use it on a level that needs touch controls, or on a touch-device check, instead of turning the stick on for the whole game in the Joystick tab.

#### Disable Joystick

Turns the on-screen joystick off at once: the base circle disappears and a held stick lets go, so the tilt reads 0 again. Use it when the player picks up the keyboard, or on a menu scene that needs the whole screen for buttons.

#### Joystick Active

True while the player is steering with the on-screen joystick — grabbed and tilted past the dead zone. Use it to show a "you are driving" hint, to switch the hero to its walking animation, or to pause the idle timer while the player steers. Evaluates every frame, even while paused.

**Fields:**

- **Invert** (options: Off, On)

#### Joystick Tilt

True while the on-screen joystick tilts the picked way past the minimum tilt (0 is centered, 1 is all the way to the edge). Use it to walk left only past half tilt, to jump when the stick goes up, or to steer with the tilt itself instead of the joystickX / joystickY variables. Evaluates every frame, even while paused.

**Fields:**

- **Direction** (options: Any direction, Up, Down, Left, Right)
- **Min tilt (0-1)**
- **Invert** (options: Off, On)

### Input Presets (75)

| Block | Type | What it does |
|---|---|---|
| 1 Held | Condition | Preset keyboard condition for 1. |
| 1 Just Pressed | Condition | Preset keyboard condition for 1. |
| 1 Released | Condition | Preset keyboard condition for 1. |
| 2 Held | Condition | Preset keyboard condition for 2. |
| 2 Just Pressed | Condition | Preset keyboard condition for 2. |
| 2 Released | Condition | Preset keyboard condition for 2. |
| 3 Held | Condition | Preset keyboard condition for 3. |
| 3 Just Pressed | Condition | Preset keyboard condition for 3. |
| 3 Released | Condition | Preset keyboard condition for 3. |
| A Held | Condition | Preset keyboard condition for A. |
| A Just Pressed | Condition | Preset keyboard condition for A. |
| A Released | Condition | Preset keyboard condition for A. |
| D Held | Condition | Preset keyboard condition for D. |
| D Just Pressed | Condition | Preset keyboard condition for D. |
| D Released | Condition | Preset keyboard condition for D. |
| Down Arrow Held | Condition | Preset keyboard condition for Down Arrow. |
| Down Arrow Just Pressed | Condition | Preset keyboard condition for Down Arrow. |
| Down Arrow Released | Condition | Preset keyboard condition for Down Arrow. |
| E / Interact Held | Condition | Preset keyboard condition for E / Interact. |
| E / Interact Just Pressed | Condition | Preset keyboard condition for E / Interact. |
| E / Interact Released | Condition | Preset keyboard condition for E / Interact. |
| Enter Held | Condition | Preset keyboard condition for Enter. |
| Enter Just Pressed | Condition | Preset keyboard condition for Enter. |
| Enter Released | Condition | Preset keyboard condition for Enter. |
| Escape Held | Condition | Preset keyboard condition for Escape. |
| Escape Just Pressed | Condition | Preset keyboard condition for Escape. |
| Escape Released | Condition | Preset keyboard condition for Escape. |
| F Held | Condition | Preset keyboard condition for F. |
| F Just Pressed | Condition | Preset keyboard condition for F. |
| F Released | Condition | Preset keyboard condition for F. |
| Left Arrow Held | Condition | Preset keyboard condition for Left Arrow. |
| Left Arrow Just Pressed | Condition | Preset keyboard condition for Left Arrow. |
| Left Arrow Released | Condition | Preset keyboard condition for Left Arrow. |
| Left Ctrl Held | Condition | Preset keyboard condition for Left Ctrl. |
| Left Ctrl Just Pressed | Condition | Preset keyboard condition for Left Ctrl. |
| Left Ctrl Released | Condition | Preset keyboard condition for Left Ctrl. |
| Left Shift Held | Condition | Preset keyboard condition for Left Shift. |
| Left Shift Just Pressed | Condition | Preset keyboard condition for Left Shift. |
| Left Shift Released | Condition | Preset keyboard condition for Left Shift. |
| Mouse held: any | Condition |  |
| Mouse held: left | Condition |  |
| Mouse held: middle | Condition |  |
| Mouse held: right | Condition |  |
| Mouse just pressed: any | Condition |  |
| Mouse just pressed: left | Condition |  |
| Mouse just pressed: middle | Condition |  |
| Mouse just pressed: right | Condition |  |
| Mouse released: any | Condition |  |
| Mouse released: left | Condition |  |
| Mouse released: middle | Condition |  |
| Mouse released: right | Condition |  |
| Q Held | Condition | Preset keyboard condition for Q. |
| Q Just Pressed | Condition | Preset keyboard condition for Q. |
| Q Released | Condition | Preset keyboard condition for Q. |
| R / Reload Held | Condition | Preset keyboard condition for R / Reload. |
| R / Reload Just Pressed | Condition | Preset keyboard condition for R / Reload. |
| R / Reload Released | Condition | Preset keyboard condition for R / Reload. |
| Right Arrow Held | Condition | Preset keyboard condition for Right Arrow. |
| Right Arrow Just Pressed | Condition | Preset keyboard condition for Right Arrow. |
| Right Arrow Released | Condition | Preset keyboard condition for Right Arrow. |
| S Held | Condition | Preset keyboard condition for S. |
| S Just Pressed | Condition | Preset keyboard condition for S. |
| S Released | Condition | Preset keyboard condition for S. |
| Space Held | Condition | Preset keyboard condition for Space. |
| Space Just Pressed | Condition | Preset keyboard condition for Space. |
| Space Released | Condition | Preset keyboard condition for Space. |
| Tab Held | Condition | Preset keyboard condition for Tab. |
| Tab Just Pressed | Condition | Preset keyboard condition for Tab. |
| Tab Released | Condition | Preset keyboard condition for Tab. |
| Up Arrow Held | Condition | Preset keyboard condition for Up Arrow. |
| Up Arrow Just Pressed | Condition | Preset keyboard condition for Up Arrow. |
| Up Arrow Released | Condition | Preset keyboard condition for Up Arrow. |
| W Held | Condition | Preset keyboard condition for W. |
| W Just Pressed | Condition | Preset keyboard condition for W. |
| W Released | Condition | Preset keyboard condition for W. |

#### 1 Held

Preset keyboard condition for 1.

**Fields:**

- **Invert** (options: Off, On)

#### 1 Just Pressed

Preset keyboard condition for 1.

**Fields:**

- **Invert** (options: Off, On)

#### 1 Released

Preset keyboard condition for 1.

**Fields:**

- **Invert** (options: Off, On)

#### 2 Held

Preset keyboard condition for 2.

**Fields:**

- **Invert** (options: Off, On)

#### 2 Just Pressed

Preset keyboard condition for 2.

**Fields:**

- **Invert** (options: Off, On)

#### 2 Released

Preset keyboard condition for 2.

**Fields:**

- **Invert** (options: Off, On)

#### 3 Held

Preset keyboard condition for 3.

**Fields:**

- **Invert** (options: Off, On)

#### 3 Just Pressed

Preset keyboard condition for 3.

**Fields:**

- **Invert** (options: Off, On)

#### 3 Released

Preset keyboard condition for 3.

**Fields:**

- **Invert** (options: Off, On)

#### A Held

Preset keyboard condition for A.

**Fields:**

- **Invert** (options: Off, On)

#### A Just Pressed

Preset keyboard condition for A.

**Fields:**

- **Invert** (options: Off, On)

#### A Released

Preset keyboard condition for A.

**Fields:**

- **Invert** (options: Off, On)

#### D Held

Preset keyboard condition for D.

**Fields:**

- **Invert** (options: Off, On)

#### D Just Pressed

Preset keyboard condition for D.

**Fields:**

- **Invert** (options: Off, On)

#### D Released

Preset keyboard condition for D.

**Fields:**

- **Invert** (options: Off, On)

#### Down Arrow Held

Preset keyboard condition for Down Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Down Arrow Just Pressed

Preset keyboard condition for Down Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Down Arrow Released

Preset keyboard condition for Down Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### E / Interact Held

Preset keyboard condition for E / Interact.

**Fields:**

- **Invert** (options: Off, On)

#### E / Interact Just Pressed

Preset keyboard condition for E / Interact.

**Fields:**

- **Invert** (options: Off, On)

#### E / Interact Released

Preset keyboard condition for E / Interact.

**Fields:**

- **Invert** (options: Off, On)

#### Enter Held

Preset keyboard condition for Enter.

**Fields:**

- **Invert** (options: Off, On)

#### Enter Just Pressed

Preset keyboard condition for Enter.

**Fields:**

- **Invert** (options: Off, On)

#### Enter Released

Preset keyboard condition for Enter.

**Fields:**

- **Invert** (options: Off, On)

#### Escape Held

Preset keyboard condition for Escape.

**Fields:**

- **Invert** (options: Off, On)

#### Escape Just Pressed

Preset keyboard condition for Escape.

**Fields:**

- **Invert** (options: Off, On)

#### Escape Released

Preset keyboard condition for Escape.

**Fields:**

- **Invert** (options: Off, On)

#### F Held

Preset keyboard condition for F.

**Fields:**

- **Invert** (options: Off, On)

#### F Just Pressed

Preset keyboard condition for F.

**Fields:**

- **Invert** (options: Off, On)

#### F Released

Preset keyboard condition for F.

**Fields:**

- **Invert** (options: Off, On)

#### Left Arrow Held

Preset keyboard condition for Left Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Left Arrow Just Pressed

Preset keyboard condition for Left Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Left Arrow Released

Preset keyboard condition for Left Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Left Ctrl Held

Preset keyboard condition for Left Ctrl.

**Fields:**

- **Invert** (options: Off, On)

#### Left Ctrl Just Pressed

Preset keyboard condition for Left Ctrl.

**Fields:**

- **Invert** (options: Off, On)

#### Left Ctrl Released

Preset keyboard condition for Left Ctrl.

**Fields:**

- **Invert** (options: Off, On)

#### Left Shift Held

Preset keyboard condition for Left Shift.

**Fields:**

- **Invert** (options: Off, On)

#### Left Shift Just Pressed

Preset keyboard condition for Left Shift.

**Fields:**

- **Invert** (options: Off, On)

#### Left Shift Released

Preset keyboard condition for Left Shift.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse held: any

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse held: left

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse held: middle

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse held: right

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse just pressed: any

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse just pressed: left

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse just pressed: middle

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse just pressed: right

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse released: any

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse released: left

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse released: middle

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Mouse released: right

No description yet.

**Fields:**

- **Invert** (options: Off, On)

#### Q Held

Preset keyboard condition for Q.

**Fields:**

- **Invert** (options: Off, On)

#### Q Just Pressed

Preset keyboard condition for Q.

**Fields:**

- **Invert** (options: Off, On)

#### Q Released

Preset keyboard condition for Q.

**Fields:**

- **Invert** (options: Off, On)

#### R / Reload Held

Preset keyboard condition for R / Reload.

**Fields:**

- **Invert** (options: Off, On)

#### R / Reload Just Pressed

Preset keyboard condition for R / Reload.

**Fields:**

- **Invert** (options: Off, On)

#### R / Reload Released

Preset keyboard condition for R / Reload.

**Fields:**

- **Invert** (options: Off, On)

#### Right Arrow Held

Preset keyboard condition for Right Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Right Arrow Just Pressed

Preset keyboard condition for Right Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Right Arrow Released

Preset keyboard condition for Right Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### S Held

Preset keyboard condition for S.

**Fields:**

- **Invert** (options: Off, On)

#### S Just Pressed

Preset keyboard condition for S.

**Fields:**

- **Invert** (options: Off, On)

#### S Released

Preset keyboard condition for S.

**Fields:**

- **Invert** (options: Off, On)

#### Space Held

Preset keyboard condition for Space.

**Fields:**

- **Invert** (options: Off, On)

#### Space Just Pressed

Preset keyboard condition for Space.

**Fields:**

- **Invert** (options: Off, On)

#### Space Released

Preset keyboard condition for Space.

**Fields:**

- **Invert** (options: Off, On)

#### Tab Held

Preset keyboard condition for Tab.

**Fields:**

- **Invert** (options: Off, On)

#### Tab Just Pressed

Preset keyboard condition for Tab.

**Fields:**

- **Invert** (options: Off, On)

#### Tab Released

Preset keyboard condition for Tab.

**Fields:**

- **Invert** (options: Off, On)

#### Up Arrow Held

Preset keyboard condition for Up Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Up Arrow Just Pressed

Preset keyboard condition for Up Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### Up Arrow Released

Preset keyboard condition for Up Arrow.

**Fields:**

- **Invert** (options: Off, On)

#### W Held

Preset keyboard condition for W.

**Fields:**

- **Invert** (options: Off, On)

#### W Just Pressed

Preset keyboard condition for W.

**Fields:**

- **Invert** (options: Off, On)

#### W Released

Preset keyboard condition for W.

**Fields:**

- **Invert** (options: Off, On)

### Lighting (3)

| Block | Type | What it does |
|---|---|---|
| Set Darkness | Action | Dims the whole 2D scene (0 = fully lit, 1 = pitch black). Lights punch holes in it. |
| Set Light | Action | Changes a light while the game runs: its radius, color, or on/off. |
| Darkness Level | Condition | True while the scene darkness compares to the value. Evaluates every frame, even while paused. |

### Physics (3)

| Block | Type | What it does |
|---|---|---|
| Create Joint | Action | Links two objects: Distance holds their centers a fixed length apart like a rigid rod, Rope lets them come closer but never stretch past the length like a chain, Spring pulls them toward the length like a stretchy cord. |
| Remove Joint | Action | Unlinks two objects. Leave Object B blank to remove every joint involving Object A. |
| Joint Connected | Condition | True while a joint links the two objects. Evaluates every frame, even while paused. |

### Skeleton (4)

| Block | Type | What it does |
|---|---|---|
| Play Skeleton Animation | Action | Plays one of the object's skeletal animations from the Inspector Skeleton section. Unknown names warn and hold; blank stays quiet. |
| Stop Skeleton Animation | Action | Stops the object's skeletal animation. Leave Animation blank to stop whichever is active. |
| Set Bone Angle | Action | Poses one bone by hand, in degrees (0 points right, 90 points down). A posed bone wins over a playing track until a new skeletal animation starts. |
| Skeleton Playing | Condition | True while the object's chosen skeletal animation is playing. A finished once-run reads false. Evaluates every frame, even while paused. |

### Localization (4)

| Block | Type | What it does |
|---|---|---|
| Set Language | Action | Switches the whole game to a language from the Localization tab. Every text object bound to a key re-reads its translation at once. Unknown codes warn and hold; blank stays quiet. |
| Set Text from Key | Action | Sets a text object's displayed text to the key's translation in the current language, falling back to the default language. Unknown keys warn and hold; blank stays quiet. |
| Set Variable from Key | Action | Copies a key's translation in the current language (falling back to the default language) into a game variable. Unknown keys warn and hold; blank stays quiet. |
| Language Is | Condition | True while the game's current language is the named one. Evaluates every frame, even while paused. |

### Dialogue (8)

| Block | Type | What it does |
|---|---|---|
| Start Dialogue | Action | Starts a dialogue from the Dialogues tab: the speaker name and the line appear in the two text objects you pick, revealed letter by letter. Starting a dialogue that is already running restarts it from the first line. Unknown names warn and hold; blank stays quiet. |
| Advance Dialogue | Action | Moves the running dialogue one step: finishes the current line's typing first, then goes to the next line (past the last line it ends). Stays quiet on a choice line — the player has to pick — and when no dialogue is running. |
| Choose Dialogue Option | Action | Picks the numbered choice (1 is the first) while the dialogue is waiting for one, jumping to the line that choice points at. A choice with no line to jump to ends the dialogue. An option number with no such choice warns and holds. |
| Stop Dialogue | Action | Ends the running dialogue at once. The speaker and text labels keep the last line that was showing. Stays quiet when no dialogue is running. |
| Set Choice Text | Action | Writes the numbered choice's label into a text object, so you can build your own choice buttons. Run it while the dialogue is waiting for a choice. An option number with no such choice warns and holds; blank stays quiet. |
| Dialogue Active | Condition | True while any dialogue is running. Evaluates every frame, even while paused. |
| Dialogue Waiting For Choice | Condition | True while the running dialogue has fully revealed a choice line and is waiting for the player to pick. Evaluates every frame, even while paused. |
| Dialogue Choice Available | Condition | True while the dialogue is waiting for a choice AND the numbered option exists (1 is the first). Evaluates every frame, even while paused. |

### Inventory (7)

| Block | Type | What it does |
|---|---|---|
| Add Item | Action | Adds the count of the named item to the backpack, up to its max stack. Unknown items and bad counts warn and hold; blank stays quiet. |
| Remove Item | Action | Removes up to the count of the named item from the backpack. Unknown items and bad counts warn and hold; blank stays quiet. |
| Set Item Count | Action | Sets the named item's count outright, clamped to 0 up to its max stack (0 drops the entry). Unknown items and bad counts warn and hold; blank stays quiet. |
| Read Item Count | Action | Copies how many of the named item the backpack holds into a game variable. A defined item with nothing carried reads 0; unknown items warn and hold. |
| Clear Inventory | Action | Empties the whole backpack at once. |
| Has Item | Condition | True while the backpack holds at least the count of the named item. Evaluates every frame, even while paused. |
| Item Count | Condition | True while the named item's count compares against the value you enter. An item never held reads as 0. Evaluates every frame, even while paused. |

### Quest (8)

| Block | Type | What it does |
|---|---|---|
| Add Quest Progress | Action | Adds the amount of progress to the named quest, up to its target; reaching the target completes it. Unknown quests and bad amounts warn and hold; blank stays quiet. |
| Set Quest Progress | Action | Sets the named quest's progress outright, clamped to 0 up to its target (0 drops the entry). Reaching the target completes the quest; setting it back below un-completes it. Unknown quests and bad amounts warn and hold; blank stays quiet. |
| Complete Quest | Action | Completes the named quest at once: progress fills to its target. Unknown quests warn and hold; blank stays quiet. |
| Reset Quest | Action | Drops the named quest's progress and done flag, so it reads as never started. Unknown quests warn and hold; blank stays quiet. |
| Read Quest Progress | Action | Copies the named quest's progress into a game variable. A defined quest with no progress yet reads 0; unknown quests warn and hold. |
| Clear Quests | Action | Empties the whole quest log at once. |
| Quest Complete | Condition | True while the named quest is complete. Evaluates every frame, even while paused. |
| Quest Progress | Condition | True while the named quest's progress compares against the value you enter. A quest never started reads as 0. Evaluates every frame, even while paused. |

### Achievement (6)

| Block | Type | What it does |
|---|---|---|
| Unlock Achievement | Action | Unlocks the named achievement for good: it stays unlocked across runs, scenes, and restarts. Unlocking one that is already unlocked changes nothing. Unknown achievements warn and hold; blank stays quiet. |
| Lock Achievement | Action | Locks the named achievement again, so it reads as never earned. Unknown achievements warn and hold; blank stays quiet. |
| Reset Achievements | Action | Locks every achievement at once. |
| Read Achievement Count | Action | Copies how many achievements are unlocked into a game variable. |
| Achievement Unlocked | Condition | True while the named achievement is unlocked. Evaluates every frame, even while paused. |
| Achievement Count | Condition | True while the number of unlocked achievements compares against the value you enter. Evaluates every frame, even while paused. |

### Cutscene (4)

| Block | Type | What it does |
|---|---|---|
| Play Cutscene | Action | Plays the named cutscene from its first step, replacing any cutscene already playing. Unknown cutscenes warn and hold; blank stays quiet. |
| Stop Cutscene | Action | Stops the running cutscene; stopping counts as finished. Blank stops whichever cutscene is playing. Unknown cutscenes warn and hold. |
| Cutscene Playing | Condition | True while the named cutscene is playing; blank means any cutscene. Evaluates every frame, even while paused. |
| Cutscene Finished | Condition | True while the named cutscene is the most recently finished one; blank means any cutscene. A natural ending or a stop both count. Evaluates every frame, even while paused. |

### High Score (5)

| Block | Type | What it does |
|---|---|---|
| Submit Score | Action | Submits a score to the ranked table, best first. A blank name uses the default name from the High Scores tab. A score that does not beat the lowest entry on a full table changes nothing; a non-numeric score warns and holds. |
| Clear High Scores | Action | Empties the whole leaderboard at once. |
| Read High Score | Action | Copies the score at the rank you enter (1 is the best) into a game variable, and its name into a second variable. A rank past the end of the table writes nothing. |
| Is High Score | Condition | True while the score would make the leaderboard — the table has room, or the score beats its lowest entry. Evaluates every frame, even while paused. |
| High Score Count | Condition | True while the number of scores on the leaderboard compares against the value you enter. Evaluates every frame, even while paused. |

### Time (4)

| Block | Type | What it does |
|---|---|---|
| Set Time Scale | Action | Sets how fast the game world runs: 1 is normal speed, 0.3 is slow motion, 0.5 is half speed, 2 is double speed, 0 freezes the world. A non-numeric scale warns and holds; any other value clamps to 0..4. |
| Reset Time Scale | Action | Back to normal speed at once. |
| Read Time Scale | Action | Copies the current time scale into a game variable. Leave the variable blank to skip it. |
| Time Scale | Condition | True while the current time scale compares against the value you enter. Evaluates every frame, even while paused. |

### Scene Transitions (4)

| Block | Type | What it does |
|---|---|---|
| Transition to Scene | Action | Switches to the scene with a fade or a wipe instead of an instant cut: the screen fades (or wipes) out, the scene switches under full cover, then it fades (or wipes) back in. The default effect and duration come from the Transitions tab; a blank Duration uses the default, and 0 switches at once. An unknown scene warns and holds. |
| Cancel Transition | Action | Stops a transition that is playing. Cancelling while the screen is fading out stays in the current scene; cancelling while it is fading back in finishes at once, since the scene already switched. |
| Transition Playing | Condition | True while a scene transition is playing. Leave the Scene blank for any transition, or pick one to gate only on the way to that scene. Evaluates every frame, even while paused. |
| Transition Finished | Condition | Fires once when a scene transition ends (an instant switch counts too). Leave the Scene blank for any transition, or pick one to run what happens next only after arriving at that scene. |

### Pathfinding (4)

| Block | Type | What it does |
|---|---|---|
| Follow Path | Action | Walks the object to a destination around the tilemap's solid tiles — an enemy chasing the player through a maze, an NPC walking to a door. Point it at an object, or at the X/Y point when no object is named. The path is found once, when the block runs, so a moving target needs a fresh Follow Path. A destination with no path warns and holds; a missing object stays quiet. |
| Stop Path | Action | Stops an object walking a path at once, right where it stands. After it, Path Finished and Has Path both read false. Does nothing when the object has no path. |
| Path Finished | Condition | True once the object has arrived at the end of its path. Evaluates every frame, even while paused. |
| Has Path | Condition | True while the object is walking a path that has not arrived yet. Evaluates every frame, even while paused. |

### AI (4)

| Block | Type | What it does |
|---|---|---|
| Set AI Behavior | Action | Gives the object a brain, so it decides where to walk on its own: Patrol walks between the two patrol points, Chase walks at the target while it stays in range, Flee walks away from the target, Wander strolls around the spot where the behavior was set. Every behavior walks around the tilemap walls through the pathfinder. A bad speed or range warns and holds; a missing object stays quiet. |
| Stop AI | Action | Stops the object thinking at once: the behavior is cleared and the object halts where it stands. After it, AI Behavior reads None and the object waits for a new Set AI Behavior. |
| AI Behavior | Condition | True while the object is running the picked behavior. Evaluates every frame, even while paused. |
| Target In Range | Condition | True while the target object is within Range pixels of the object, center to center. Evaluates every frame, even while paused. |

### Health (10)

| Block | Type | What it does |
|---|---|---|
| Damage Object | Action | Takes hit points off the object, stopping at 0. A bad amount warns and holds; a missing object stays quiet. |
| Heal Object | Action | Gives hit points back to the object, stopping at its max. A bad amount warns and holds; a missing object stays quiet. |
| Set Health | Action | Writes an exact health value, clamped between 0 and the object's max. A bad value warns and holds; a missing object stays quiet. |
| Set Max Health | Action | Moves the object's health ceiling; the current health re-clamps to the new ceiling. A bad value warns and holds; a missing object stays quiet. |
| Show Damage Number | Action | Pops a floating number above the object that rises and fades out over about a second. Display only — it never changes the health itself. A bad amount warns and holds; a missing object stays quiet. |
| Make Invincible | Action | Gives the object a shield for the picked seconds — Damage Object skips it while the shield holds. 0 seconds clears the shield at once. A bad value warns and holds; a missing object stays quiet. |
| Knockback Object | Action | Pushes the object away from a source object or an X/Y point, with the picked force. A bad value warns and holds; a missing object stays quiet. |
| Health | Condition | True while the object's health compares with the value the picked way. Evaluates every frame, even while paused. |
| Object Died | Condition | True while the object's health is 0. Fires once on the killing hit. Evaluates every frame, even while paused. |
| Is Invincible | Condition | True while the object's shield still holds. Evaluates every frame, even while paused. |

#### Damage Object

Takes hit points off the object, stopping at 0 — an enemy at 10 hit points hit for 25 reads 0, not -15. Use it when a bullet lands, a spike touches the player, or a trap fires. The hit that reaches 0 is the one Object Died fires on. A bad amount warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Amount** - e.g. 10

#### Heal Object

Gives hit points back to the object, stopping at its max — a potion never overfills the bar. Use it when the player grabs a heart, stands in a healing zone, or levels up. A bad amount warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Amount** - e.g. 10

#### Set Health

Writes an exact health value, clamped between 0 and the object's max — use it to reset the player to full at a checkpoint, to set a boss to half health when the fight starts, or to load a saved health value back after Load Game. A bad value warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Value** - e.g. 100

#### Set Max Health

Moves the object's health ceiling — a level-up raises it, a curse lowers it. The current health re-clamps to the new ceiling, so a lowered max never leaves health above the bar. Use it when the player upgrades armor or a boss enrages. A bad value warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Value** - e.g. 100

#### Health

True while the object's health compares with the value the picked way — at least 50, exactly 0, below a quarter. Use it to flash a low-health warning, to make a boss change attacks under half health, or to heal the player only when hurt. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Compare** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 0
- **Invert** (options: Off, On)

#### Object Died

True while the object's health is 0 — it fires once on the killing hit, so a chained explosion or game-over screen runs once instead of every frame the body lies there. The block never destroys the object itself: chain Destroy Object, Hide Object, or a death animation after it. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

#### Show Damage Number

Pops a floating number above the object — it rises and fades out over about a second, so the player sees the hit land. Place it right after Damage Object with the same amount. The number is only a display: it never changes the health itself. A bad amount warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Amount** - e.g. 10
- **Color**

#### Make Invincible

Gives the object a shield for the picked seconds — Damage Object skips it while the shield holds, so the classic hit-then-brief-shield loop is Damage Object followed by this block. 0 seconds clears the shield at once. Heal and Set Health still apply to a shielded object: the shield blocks hits, not help. A bad value warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Seconds** - e.g. 1

#### Knockback Object

Pushes the object away from a source object, or from the X/Y point when From object is blank — the classic hit reaction after Damage Object. When the source sits exactly on the object there is no direction to push, so it pushes straight up instead. The push moves any non-static, non-text object (a static wall or a text object stays put), and the object's max speed caps how fast it can fly. A bad value warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **From object**
- **X** - e.g. 0
- **Y** - e.g. 0
- **Force** - e.g. 300

#### Is Invincible

True while the object's shield still holds — use it to flash the sprite while invincible, to skip a second hit yourself, or to show a shield icon only while it lasts. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

### Respawn (5)

| Block | Type | What it does |
|---|---|---|
| Set Checkpoint | Action | Records the spot the object comes back to after dying: the top-left corner of the checkpoint object, or the X/Y point when no object is named. A new checkpoint replaces the old one. A bad X/Y warns and holds; a missing object stays quiet. |
| Respawn Object | Action | Sends the object back to the last checkpoint, or to where it started the scene when no checkpoint is set yet. Zeroes the velocity, stops a walking path, and refills the health to full while Restore health is ticked. A missing object stays quiet. |
| Clear Checkpoint | Action | Forgets the checkpoint for this scene, so the next respawn goes home to the start position instead. |
| Checkpoint Set | Condition | True while a checkpoint is recorded for this scene. Evaluates every frame, even while paused. |
| Respawn Count | Condition | True while the scene's respawn count compares with the value the picked way. Evaluates every frame, even while paused. |

#### Set Checkpoint

Records the spot the player comes back to after dying — the top-left corner of the checkpoint object, or the X/Y point when no object is named. Put a flag at each safe spot and run this when the player touches it; a new checkpoint replaces the old one, so the respawn moves forward as the player passes each flag. A bad X/Y warns and holds; a missing object stays quiet.

**Fields:**

- **Checkpoint object**
- **X** - e.g. 0
- **Y** - e.g. 0

#### Respawn Object

Sends the object back to the last checkpoint — or to where it started the scene, when no checkpoint is set yet. The teleport zeroes the velocity and stops a walking path, and refills the health to full while Restore health is ticked (untick it for a hardcore run where the player comes back hurt). Chain it after Object Died for the classic die-and-respawn loop. A missing object stays quiet.

**Fields:**

- **Object**
- **Restore health**

#### Clear Checkpoint

Forgets the checkpoint for this scene, so the next respawn sends the object back to where it started instead. Use it when a level restarts, when the player leaves the checkpoint area, or to reset the run after a game over.

**Fields:**

None.

#### Checkpoint Set

True while a checkpoint is recorded for this scene — use it to show a "checkpoint reached" banner only after the player passes a flag, or (inverted) to flash "no checkpoint yet" at the start. A fresh scene starts with none set. Evaluates every frame, even while paused.

**Fields:**

- **Invert** (options: Off, On)

#### Respawn Count

True while the scene's respawn count compares with the value the picked way — at least 1 after the first death, at least 3 for a three-lives game over. The count resets with the scene, so it counts deaths in this level only. Evaluates every frame, even while paused.

**Fields:**

- **Compare**
- **Value** - e.g. 1
- **Invert** (options: Off, On)

### Spawner (5)

| Block | Type | What it does |
|---|---|---|
| Start Spawner | Action | Starts a named spawner: every few seconds it clones the Spawn object at the At object, or at the X/Y point when no object is named, until Max alive are on screen or Total have spawned. Max alive 0 means no cap, Total 0 means endless. A blank name or a blank Spawn object stays quiet; a bad interval, max alive, total, or X/Y warns and holds. |
| Stop Spawner | Action | Stops the named spawner, so it never spawns again. Leave the name blank to stop every spawner at once. An unknown name stays quiet. |
| Read Spawned Count | Action | Copies how many the named spawner has made into a game variable. A spawner that never started reads 0; a blank variable name warns and holds. |
| Spawner Active | Condition | True while the named spawner runs. A spawner that reached its total reads as stopped. Evaluates every frame, even while paused. |
| Spawned Count | Condition | True while the named spawner's spawned total compares with the value the picked way. Evaluates every frame, even while paused. |

#### Start Spawner

Starts a named spawner: every few seconds it clones the Spawn object at the At object (or at the X/Y point when no object is named) until Max alive are on screen, or until Total have spawned. Max alive 0 means no cap, Total 0 means endless. The first spawn lands after one interval, never at once. Starting a spawner that already runs restarts it, timer and count fresh. A blank name or a blank Spawn object stays quiet; a bad interval, max alive, total, or X/Y warns and holds.

**Fields:**

- **Spawner name** - e.g. goblins
- **Spawn object**
- **At object**
- **X** - e.g. 0
- **Y** - e.g. 0
- **Every (seconds)** - e.g. 2
- **Max alive** - e.g. 10
- **Total to spawn** - e.g. 0

#### Stop Spawner

Stops the named spawner, so it never spawns again — use it when the wave is beaten, when the player leaves the area, or to end the level. Leave the name blank to stop every spawner at once. An unknown name stays quiet.

**Fields:**

- **Spawner name** - e.g. goblins

#### Read Spawned Count

Copies how many the named spawner has made into a game variable, so you can show it in a label, compare it, or save it with Save Game (then re-start the spawner after Load Game). A spawner that never started reads 0; a blank variable name warns and holds.

**Fields:**

- **Spawner name** - e.g. goblins
- **Into variable** - e.g. goblinsSpawned

#### Spawner Active

True while the named spawner runs — use it to show a "wave incoming" banner only while enemies are still spawning, or (inverted) to open the goal door once the wave is done. A spawner that reached its total reads as stopped. Evaluates every frame, even while paused.

**Fields:**

- **Spawner name** - e.g. goblins
- **Invert** (options: Off, On)

#### Spawned Count

True while the named spawner's spawned total compares with the value the picked way — at least 10 for a ten-spawn wave gate, at least 1 once the first enemy has arrived. The count resets with the scene, so it counts spawns in this level only. Evaluates every frame, even while paused.

**Fields:**

- **Spawner name** - e.g. goblins
- **Compare**
- **Value** - e.g. 1
- **Invert** (options: Off, On)

### Lives (6)

| Block | Type | What it does |
|---|---|---|
| Set Lives | Action | Sets how many lives the player has — 3 is the classic arcade default, 0 starts the game already over. A bad value warns and holds. |
| Add Lives | Action | Gives the player more lives. The count stops at 99. A bad amount warns and holds. |
| Lose Life | Action | Takes lives away — one at a time by default. The count never goes below 0. A bad amount warns and holds. |
| Read Lives | Action | Copies how many lives are left into a game variable. A game that never touched lives reads 3; a blank variable name warns and holds. |
| Lives | Condition | True while the lives count compares with the value the picked way. Evaluates every frame, even while paused. |
| Game Over | Condition | True while the game is over — the lives count reads 0. It fires once, exactly when the last life is lost. Evaluates every frame, even while paused. |

#### Set Lives

Sets how many lives the player has — 3 is the classic arcade default, 0 starts the game already over. Lives survive scene switches inside a run, so set them once at gameStart. A bad value warns and holds.

**Fields:**

- **Lives** - e.g. 3

#### Add Lives

Gives the player more lives — a 1-up, a bonus life for beating a level, a continue. The count stops at 99. A bad amount warns and holds.

**Fields:**

- **Amount** - e.g. 1

#### Lose Life

Takes lives away — one at a time by default. Chain it after Object Died for the classic die-and-respawn loop, then Respawn Object to bring the player back. The count never goes below 0, so losing a life at 0 stays at 0. A bad amount warns and holds.

**Fields:**

- **Amount** - e.g. 1

#### Read Lives

Copies how many lives are left into a game variable, so you can show it in a label, compare it, or save it with Save Game (then Set Lives from it after Load Game). A game that never touched lives reads 3; a blank variable name warns and holds.

**Fields:**

- **Into variable** - e.g. livesLeft

#### Lives

True while the lives count compares with the value the picked way — at least 1 while the player still has a life left, exactly 0 when the game is over. The count survives scene switches, so it counts lives for the whole game, not one level. Evaluates every frame, even while paused.

**Fields:**

- **Compare**
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### Game Over

True while the game is over — the lives count reads 0. It fires once, exactly when the last life is lost, so chain it to Switch Scene for the game-over screen. Gaining a life after game over clears it, so losing the last life again fires it again. Evaluates every frame, even while paused.

**Fields:**

- **Invert** (options: Off, On)

### Movement (10)

| Block | Type | What it does |
|---|---|---|
| Jump | Action | Makes the object jump — on the ground, just after a ledge (coyote time), or in the air up to its Max jumps. A press with no jump left is remembered for the jump-buffer window and fires on landing. |
| Dash | Action | Bursts the object in one direction at an exact speed for a fixed duration, then a cooldown. |
| Set Max Jumps | Action | Sets how many jumps the object gets before it must land again — 1 is a single jump, 2 is the classic double jump. |
| Set Coyote Time | Action | Sets the grace window in seconds after walking off a ledge during which a jump still counts. |
| Set Jump Buffer | Action | Sets how long a jump press is remembered for when no jump is available, so it fires on landing. |
| Jumps Left | Condition | True while the object's jumps left compare with the value the picked way. Evaluates every frame, even while paused. |
| Is Dashing | Condition | True while the object is mid-dash — inside the burst the Dash block started. Evaluates every frame, even while paused. |
| Set Wall Slide | Action | Sets how fast the object may fall while sliding down a wall — 60 px/s is a slow slide, 0 turns the slide off. |
| Set Wall Jump | Action | Sets the wall jump: how hard the object jumps off a wall, and how hard it is pushed away from it. |
| Wall Sliding | Condition | True while the object slides down a wall — airborne, falling, pressing toward a solid wall it touches, with a slide speed set. Evaluates every frame, even while paused. |

#### Jump

Makes the object jump — on the ground, just after walking off a ledge while the coyote window holds, or in the air up to its Max jumps (2 is the classic double jump). A press with no jump left is remembered for the jump-buffer window and fires on landing. Jump speed 12 is a solid platformer jump. A bad speed warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Jump speed** - e.g. 12

#### Dash

Bursts the object in one direction at an exact speed — 400 px/s for 0.15 seconds covers about 60 pixels. Gravity cannot droop the burst and friction cannot decay it. A dash already running or still cooling down is ignored, so one press is one dash. A bad number warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Direction** (options: Left, Right, Up, Down)
- **Speed (px/s)** - e.g. 400
- **Duration (s)** - e.g. 0.15
- **Cooldown (s)** - e.g. 0.5

#### Set Max Jumps

Sets how many jumps the object gets before it must land again — 1 is a single jump, 2 is the classic double jump. A power-up that grants a double jump is one block. A bad count warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Jumps** - e.g. 2

#### Set Coyote Time

Sets the grace window in seconds after walking off a ledge during which a jump still counts — 0.1 is the classic forgiving platformer feel, 0 turns it off. A bad value warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Seconds** - e.g. 0.1

#### Set Jump Buffer

Sets how long a jump press is remembered for when no jump is available — 0.1 means a press just before landing fires on landing instead of being lost. 0 turns it off. A bad value warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Seconds** - e.g. 0.1

#### Jumps Left

True while the object's jumps left compare with the value the picked way — at least 1 while the player can still jump, exactly 0 while every jump is spent until the next landing. Use it to show a double-jump icon only when the air jump is ready. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Compare**
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### Is Dashing

True while the object is mid-dash — inside the burst the Dash block started. Use it to spawn dash particles, play a whoosh, or make the player invincible while dashing (chain Make Invincible after Dash). Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

#### Set Wall Slide

Sets how fast the object may fall while sliding down a wall — 60 px/s is a slow slide, 0 turns the slide off. The slide only holds while the object keeps pressing toward the wall (arrow keys or A/D). A bad speed warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Max fall speed (px/s)** - e.g. 60

#### Set Wall Jump

Sets the wall jump: how hard the object jumps off a wall, and how hard it is pushed away from it. The Jump block performs the wall jump while the object touches a wall — it costs one air jump, so Max jumps still bounds the climb, and one wall jump per wall until the hero lands or reaches another wall. A bad number warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Jump speed** - e.g. 12
- **Push away** - e.g. 8

#### Wall Sliding

True while the object slides down a wall — airborne, falling, pressing toward a solid wall it touches, with a slide speed set. Use it to play a slide sound, spawn wall dust, or show a climbing hint. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

### Combat (3)

| Block | Type | What it does |
|---|---|---|
| Melee Attack | Action | Swings in front of the attacker — every solid object inside the 90-degree arc out to the range takes the damage, and a white slash arc flashes for a moment. |
| Shoot Projectile | Action | Fires a copy of the projectile object from the shooter's edge, flying straight until it hits the first solid object or its lifetime ends. |
| Attack Ready | Condition | True while the object's picked attack has cooled down — a melee swing or a shot is ready to fire again. Evaluates every frame, even while paused. |

#### Melee Attack

Swings in front of the attacker — every solid object inside the 90-degree arc out to the range takes the damage, and a white slash arc flashes for a moment. An attack pressed during the cooldown does nothing, so one press is one swing. Invincible targets skip the hit, and Object Died still fires on the killing blow. A bad number warns and holds; a missing object stays quiet. This block is a preset: the same swing is rebuildable by hand from List Overlapping Objects, For Each Item, Read Object Property, and Damage Object — see "Rebuilding the attacks from primitives" in the user guide.

**Fields:**

- **Attacker**
- **Damage** - e.g. 10
- **Range (px)** - e.g. 60
- **Direction** (options: Left, Right, Up, Down)
- **Cooldown (s)** - e.g. 0.5

#### Shoot Projectile

Fires a copy of the projectile object from the shooter's edge, flying straight until it hits the first solid object or its lifetime ends — one hit, no piercing. Make the projectile a small sprite with collision on; the shooter never hits itself. A shot pressed during the cooldown does nothing. A bad number warns and holds; a missing shooter or projectile stays quiet. This block is a preset: the same shot is rebuildable by hand from Spawn Object Into Variable, Pick Nearest, Move Toward Position, List Overlapping Objects, and Destroy Object In Variable — see "Rebuilding the attacks from primitives" in the user guide.

**Fields:**

- **Shooter**
- **Projectile**
- **Direction** (options: Left, Right, Up, Down)
- **Speed (px/s)** - e.g. 300
- **Damage** - e.g. 10
- **Lifetime (s)** - e.g. 2
- **Cooldown (s)** - e.g. 0.5

#### Attack Ready

True while the object's picked attack has cooled down — a melee swing or a shot is ready to fire again. Gate a fire button on it instead of spamming a refused attack every frame. An object that never attacked reads as ready. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Attack** (options: Melee, Shot)
- **Cooldown (s)** - e.g. 0.5
- **Invert** (options: Off, On)

### Platform (5)

| Block | Type | What it does |
|---|---|---|
| Set Platform Path | Action | Turns the object into a moving platform that slides between two points at a fixed speed. |
| Set One-Way Platform | Action | Makes the object a one-way platform: jump up through it from below, land on it from above. |
| Set Crumble Time | Action | Sets how long the object holds after a rider stands on it before it falls away. |
| Standing On Platform | Condition | True while the object stands on a moving platform. Evaluates every frame, even while paused. |
| Standing On One-Way | Condition | True while the object stands on a one-way platform. Evaluates every frame, even while paused. |

#### Set Platform Path

Turns the object into a moving platform that slides between two points — 60 px/s between (0, 0) and (200, 0) is a gentle back-and-forth ride. Ping-pong goes there and back; Loop jumps back to the first point and starts over. Anything standing on the platform rides it. A bad number warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Point 1 X** - e.g. 0
- **Point 1 Y** - e.g. 0
- **Point 2 X** - e.g. 200
- **Point 2 Y** - e.g. 0
- **Speed (px/s)** - e.g. 60
- **Mode** (options: Ping-pong, Loop)

#### Set One-Way Platform

Makes the object a one-way platform: jump up through it from below, land on it from above. Works on any object, platform or plain floor — it flips the same flag the Inspector Collision section sets. A missing object stays quiet.

**Fields:**

- **Object**
- **One-way** (options: On, Off)

#### Set Crumble Time

Sets how long the object holds after a rider stands on it before it falls away — 2 seconds is a fair crossing window, 0 means it never crumbles. Once the timer starts it runs to the end even if the rider steps off. A bad value warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Seconds** - e.g. 2

#### Standing On Platform

True while the object stands on a moving platform — the ride is on. Use it to play a platform hum, or to warn the player before a crumbling platform gives way. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

#### Standing On One-Way

True while the object stands on a one-way platform — a floor you jump up through and land on from above. Works for any one-way floor, platform or plain. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

### XP (8)

| Block | Type | What it does |
|---|---|---|
| Add XP | Action | Gives the player experience points. |
| Set XP | Action | Writes the XP total outright. |
| Set XP Per Level | Action | Sets how much XP one level costs. |
| Read XP | Action | Copies how much XP the player has into a game variable. |
| Read Level | Action | Copies the player level into a game variable. |
| XP | Condition | True while the XP total compares with the value the picked way. Evaluates every frame, even while paused. |
| Level | Condition | True while the player level compares with the value the picked way. Evaluates every frame, even while paused. |
| Level Up | Condition | Fires once, exactly when the player levels up. Evaluates every frame, even while paused. |

#### Add XP

Gives the player experience points — 10 is one coin or one defeated enemy. At 100 XP per level, ten of these is a level up. A bad amount warns and holds.

**Fields:**

- **Amount** - e.g. 10

#### Set XP

Writes the XP total outright — 0 starts the player fresh, 100 starts them at level 2. XP survives scene switches inside a run, so set it once at gameStart. A bad value warns and holds.

**Fields:**

- **XP** - e.g. 0

#### Set XP Per Level

Sets how much XP one level costs — 100 is the classic default, 50 levels up twice as fast, 200 makes every level a grind. The level is always the math on the current numbers, so changing it re-levels at once. A bad amount warns and holds.

**Fields:**

- **Amount** - e.g. 100

#### Read XP

Copies how much XP the player has into a game variable, so you can show it in a label, compare it, or save it with Save Game (then Set XP from it after Load Game). A game that never touched XP reads 0; a blank variable name warns and holds.

**Fields:**

- **Into variable** - e.g. xpTotal

#### Read Level

Copies the player level into a game variable, so you can show it in a label, compare it, or save it with Save Game (then Set XP from it after Load Game). A game that never touched XP reads level 1; a blank variable name warns and holds.

**Fields:**

- **Into variable** - e.g. playerLevel

#### XP

True while the XP total compares with the value the picked way — at least 100 once the player has earned a level's worth, exactly 0 before the first kill. The total survives scene switches, so it counts XP for the whole game, not one level. Evaluates every frame, even while paused.

**Fields:**

- **Compare** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 10
- **Invert** (options: Off, On)

#### Level

True while the player level compares with the value the picked way — at least 2 once the player has leveled up, exactly 1 before the first level. Gate a locked door or a stronger enemy on it. Evaluates every frame, even while paused.

**Fields:**

- **Compare** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 2
- **Invert** (options: Off, On)

#### Level Up

Fires once, exactly when the player levels up — chain it to Heal Object for a level-up heal, Play Sound for the fanfare, or Show for a LEVEL UP banner. It is consumed on read, so place one Level Up row per reward chain. Evaluates every frame, even while paused.

**Fields:**

- **Invert** (options: Off, On)

### Growth (7)

| Block | Type | What it does |
|---|---|---|
| Grow Max Health | Action | Raises the object's max health and heals it by the same amount. |
| Grow Damage | Action | Adds a lasting damage bonus to the object. |
| Grow Speed | Action | Adds a lasting speed bonus to the object. |
| Level Reward | Action | Grants a whole level-up reward in one block. |
| Read Max Health Bonus | Action | Copies how much max health the object has grown into a game variable. |
| Read Damage Bonus | Action | Copies how much damage the object has grown into a game variable. |
| Read Speed Bonus | Action | Copies how much speed the object has grown into a game variable. |

#### Grow Max Health

Raises the object's max health by the amount and heals it by the same amount, so a level up both toughens the hero and tops the bar back up. Chain it after Level Up. Turn Heal off to raise the ceiling without the heal. The growth follows the object's name across scenes. A bad amount warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Amount** - e.g. 10
- **Heal too** (options: On, Off)

#### Grow Damage

Adds a lasting damage bonus to the object — 2 by default, so a hero that leveled twice with this hits for +4. Melee Attack and Shoot Projectile add the bonus to their block damage. Damage Object does not add it: it names the victim, not an attacker, so read the bonus and add it in the amount expression instead (10 + dmgBonus). Chain it after Level Up. The growth follows the object's name across scenes. A bad amount warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Amount** - e.g. 2

#### Grow Speed

Adds a lasting speed bonus to the object — 50 by default, so a 400-speed dash becomes a 450 dash. The Dash block adds the bonus to its speed. Walking speed is untouched: it comes from Set Velocity and Move Toward blocks with their own speeds. Chain it after Level Up. The growth follows the object's name across scenes. A bad amount warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Amount** - e.g. 50

#### Level Reward

Grants a whole level-up reward in one block — Balanced (+10 max health, heal 10, +2 damage), Tank (+20 max health, heal 20), Striker (+5 damage), or Swift (+50 dash speed). Every bundle is just the Grow blocks packed together, so you can always rebuild the same reward by hand. Chain it after Level Up. An unknown bundle warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Reward** (options: Balanced, Tank, Striker, Swift)

#### Read Max Health Bonus

Copies how much max health the object has grown into a game variable, so you can show it in a label, compare it, or save it with Save Game. An object that never grew reads 0. A blank variable name warns and holds; a missing object reads 0.

**Fields:**

- **Object**
- **Into variable** - e.g. hpBonus

#### Read Damage Bonus

Copies how much damage the object has grown into a game variable, so you can show it in a label, compare it, or save it with Save Game. An object that never grew reads 0. A blank variable name warns and holds; a missing object reads 0.

**Fields:**

- **Object**
- **Into variable** - e.g. dmgBonus

#### Read Speed Bonus

Copies how much speed the object has grown into a game variable, so you can show it in a label, compare it, or save it with Save Game. An object that never grew reads 0. A blank variable name warns and holds; a missing object reads 0.

**Fields:**

- **Object**
- **Into variable** - e.g. spdBonus

### Scaling (7)

| Block | Type | What it does |
|---|---|---|
| Set Enemy Level | Action | Sets the enemy's level, raising its max health and damage. |
| Set Scaling Rates | Action | Sets what one level is worth for the enemy. |
| Scale to Hero Level | Action | Sets the enemy's level to the hero's current level. |
| Read Enemy Level | Action | Copies the enemy's level into a game variable. |
| Read Scaled HP Bonus | Action | Copies how much max health the enemy gained from its level into a game variable. |
| Read Scaled Damage Bonus | Action | Copies how much damage the enemy gained from its level into a game variable. |
| Enemy Level | Condition | True while the enemy's level compares with the value the picked way. |

#### Set Enemy Level

Sets the enemy's level — 1 is an unscaled enemy, 3 at the default rates is +20 max health and +4 damage. The max health rises by the bonus (and heals by the same amount when it rises), and the damage bonus rides along on the enemy's Melee Attack and Shoot Projectile hits. Chain it after Level Up, or put it on a gameStart row so each scene's enemies scale when the scene starts. The level follows the object's name across scenes. A bad level warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **Level** - e.g. 1

#### Set Scaling Rates

Sets what one level is worth for the enemy — 10 health and 2 damage per level by default, so a level-3 enemy is +20 max health and +4 damage. Give a boss 50 health per level and a minion 5, and they scale apart. The max health re-applies at once when the rates change. A bad rate warns and holds; a missing object stays quiet.

**Fields:**

- **Object**
- **HP per level** - e.g. 10
- **Damage per level** - e.g. 2

#### Scale to Hero Level

Sets the enemy's level to the hero's current level in one block — the fastest way to keep a fight fair. Chain it after Level Up to re-scale every enemy still alive, or put it on a gameStart row so each scene's enemies arrive at the hero's level. The level follows the object's name across scenes. A missing object stays quiet.

**Fields:**

- **Object**

#### Read Enemy Level

Copies the enemy's level into a game variable, so you can show it in a label, compare it, or save it with Save Game. An enemy that was never scaled reads 1. A blank variable name warns and holds; a missing object reads 1.

**Fields:**

- **Object**
- **Into variable** - e.g. enemyLevel

#### Read Scaled HP Bonus

Copies how much max health the enemy has gained from its level into a game variable, so you can show it in a label, compare it, or save it with Save Game. A level-1 enemy reads 0. A blank variable name warns and holds; a missing object reads 0.

**Fields:**

- **Object**
- **Into variable** - e.g. scaledHp

#### Read Scaled Damage Bonus

Copies how much damage the enemy has gained from its level into a game variable, so you can show it in a label, compare it, or save it with Save Game. A level-1 enemy reads 0. A blank variable name warns and holds; a missing object reads 0.

**Fields:**

- **Object**
- **Into variable** - e.g. scaledDmg

#### Enemy Level

True while the enemy's level compares with the value the picked way — at least 3 once the enemy has scaled twice, exactly 1 before it ever scaled. Gate a stronger wave or a level-locked door on it. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Compare** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 2
- **Invert** (options: Off, On)

### Boss (7)

| Block | Type | What it does |
|---|---|---|
| Start Boss | Action | Starts a boss fight with the named object, with 2 to 5 health phases. |
| End Boss | Action | Ends the boss fight and hides the bar. |
| Show Boss Bar | Action | Shows the boss health bar again. |
| Hide Boss Bar | Action | Hides the boss health bar without ending the fight. |
| Read Boss Phase | Action | Copies the boss fight's current phase number into a game variable. |
| Boss Phase | Condition | True while the boss fight's phase compares with the value the picked way. |
| Boss Active | Condition | True while a boss fight is running. |

#### Start Boss

Starts a boss fight with the named object — the big fight at the end of the run. The fight has 2 to 5 phases (3 by default), equal slices of the boss's health bar, so Boss Phase counts 1 at full health and reaches the last phase in the final slice. The wide bar across the top of the screen shows while the fight runs. Starting a second boss replaces the first. A blank object name warns and holds; a boss that has not spawned yet still counts, and its bar appears when it does.

**Fields:**

- **Object**
- **Phases** - e.g. 3
- **Show bar**

#### End Boss

Ends the boss fight — the bar hides and Boss Phase reads 0 again. Nothing ends the fight on its own: chain it after Object Died on the boss, on the same row as the win screen, the XP reward, or the next-level unlock. Quiet when no fight is running.

#### Show Boss Bar

Shows the boss health bar again after hiding it — bring it back when a cutscene ends and the fight resumes. Quiet when no fight is running.

#### Hide Boss Bar

Hides the boss health bar without ending the fight — clear the screen for a cutscene, then Show Boss Bar when the fight resumes. Quiet when no fight is running.

#### Read Boss Phase

Copies the boss fight's current phase number into a game variable, so you can show it in a label, compare it, or save it with Save Game. No fight running reads 0, and a boss that has not spawned yet reads 0 too. A blank variable name warns and holds.

**Fields:**

- **Into variable** - e.g. bossPhase

#### Boss Phase

True while the boss fight's phase compares with the value the picked way — at least 2 once the boss drops below two thirds of its health, exactly 3 in the final slice. Hang the phase behavior on it: a faster AI, harder hits, minions on the phase change. Evaluates every frame, even while paused.

**Fields:**

- **Compare** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 2
- **Invert** (options: Off, On)

#### Boss Active

True while a boss fight is running — from Start Boss until End Boss, even before the boss spawns. Gate the fight music, the arena doors, or the phase rows on it. Evaluates every frame, even while paused.

**Fields:**

- **Invert** (options: Off, On)

### Tags (10)

| Block | Type | What it does |
|---|---|---|
| Add Tag | Action | Sticks a label on the object while the game runs. |
| Remove Tag | Action | Takes a label off the object while the game runs. |
| Clear Tags | Action | Takes every label off the object at once. |
| Read Tagged Count | Action | Copies how many live objects carry the tag into a game variable. |
| Has Tag | Condition | True while any live object with the name carries the tag. |
| Tagged Count | Condition | True while the number of live objects carrying the tag compares with the value the picked way. |
| Pick Nearest Tagged | Condition | Picks the nearest live object carrying the tag. |
| Pick Farthest Tagged | Condition | Picks the furthest live object carrying the tag. |
| Pick Random Tagged | Condition | Picks one random live object carrying the tag. |
| Pick Tagged Object Into Variable | Action | Picks one live object carrying the tag and stores it in a variable. |

#### Add Tag

Sticks a label on the object while the game runs — tag the goblins goblin, the coins coin, the boss boss. Tags match without caring about capitals, so Goblin and goblin are the same tag, and an object holds at most 16. The tag lasts until the scene loads again; the Inspector chips are the permanent ones. A blank object or tag warns and holds.

**Fields:**

- **Object**
- **Tag** - e.g. goblin

#### Remove Tag

Takes a label off the object while the game runs — untag a goblin once it stops being one. A tag that was never there stays quiet. A blank object or tag warns and holds.

**Fields:**

- **Object**
- **Tag** - e.g. goblin

#### Clear Tags

Takes every label off the object at once — wipe a repurposed enemy clean before tagging it as something else. A blank object warns and holds.

**Fields:**

- **Object**

#### Read Tagged Count

Counts how many live objects carry the tag right now and copies the count into a game variable, so a label can show it or Save Game can keep it. A blank tag or variable name warns and holds.

**Fields:**

- **Tag** - e.g. goblin
- **Into variable** - e.g. goblinsLeft

#### Has Tag

True while any live object with the name carries the tag — a goblin is elite, a coin is golden. Matching ignores capitals. A blank object or tag reads as false, quietly. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Tag** - e.g. goblin
- **Invert** (options: Off, On)

#### Tagged Count

True while the number of live objects carrying the tag compares with the value the picked way — exactly 0 once every goblin is gone, so the win row is Tagged Count goblin equals 0. A blank tag counts 0. Evaluates every frame, even while paused.

**Fields:**

- **Tag** - e.g. goblin
- **Compare** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 0
- **Invert** (options: Off, On)

#### Pick Nearest Tagged

Picks the nearest live object carrying the tag to the Near object (leave Near object blank to measure from the X/Y point instead) — the closest goblin, whatever the goblins are called. An action chained after this block that names the picked object's name applies ONLY to the picked object. True while at least one live object carries the tag. A blank tag reads as false, quietly. Evaluates every frame, even while paused.

**Fields:**

- **Tag** - e.g. goblin
- **Near object**
- **Point X** - 400
- **Point Y** - 300
- **Invert** (options: Off, On)

#### Pick Farthest Tagged

Picks the furthest live object carrying the tag from the Near object (leave Near object blank to measure from the X/Y point instead). An action chained after this block that names the picked object's name applies ONLY to the picked object. True while at least one live object carries the tag. A blank tag reads as false, quietly. Evaluates every frame, even while paused.

**Fields:**

- **Tag** - e.g. goblin
- **Near object**
- **Point X** - 400
- **Point Y** - 300
- **Invert** (options: Off, On)

#### Pick Random Tagged

Picks one random live object carrying the tag. An action chained after this block that names the picked object's name applies ONLY to the picked object. Fires once per appearance by default (switch the trigger mode to "While true" for a fresh random pick every frame). A blank tag reads as false, quietly.

**Fields:**

- **Tag** - e.g. goblin
- **Invert** (options: Off, On)

#### Pick Tagged Object Into Variable

Picks one live object carrying the tag and stores it in a variable, so the game can keep track of one goblin even when the goblins have different names. Nearest and Farthest measure from the Near object when one is named, otherwise from the X/Y point; Random and First need no reference. Read it back with Read Object Property, destroy it with Destroy Object In Variable, or test it with Is Alive. Actions chained after it that target the same object name hit only the picked object. No live tagged object stays quiet and writes nothing; a blank tag or variable name warns and holds.

**Fields:**

- **Tag** - e.g. goblin
- **Pick** (options: Nearest, Farthest, Random, First)
- **Near object (optional)**
- **X** - 0
- **Y** - 0
- **Into variable** - target
- **Scope** (options: Global (whole game), Scene (this scene only), Object (per object name), Local (this function only))
- **Scope object**

### Minimap (5)

| Block | Type | What it does |
|---|---|---|
| Show Minimap | Action | Shows the minimap for the current scene. |
| Hide Minimap | Action | Hides the minimap for the current scene. |
| Set Minimap Size | Action | Sets how big the minimap draws, in pixels on a side. |
| Set Minimap Zoom | Action | Sets how much of the level the minimap shows. |
| Minimap Visible | Condition | True while the minimap is showing for the current scene. |

#### Show Minimap

Shows the minimap for the current scene — the small live map in the corner, with a dot for every live object and a white rectangle for what the camera sees. The scene's Minimap setting decides whether it starts shown; this block turns it on mid-run, for example when the player picks up the map. Quiet when the map is already showing.

#### Hide Minimap

Hides the minimap for the current scene without touching the scene's Minimap setting — clear the screen for a cutscene, then Show Minimap when it ends. Quiet when the map is already hidden.

#### Set Minimap Size

Sets how big the minimap draws, in pixels on a side — 80 to 400, 160 by default. A bigger map reads further across a large level. The change lasts for the current scene only; the scene's Minimap setting keeps its own size. A bad size warns and holds.

**Fields:**

- **Size (px)** - 160

#### Set Minimap Zoom

Sets how much of the level the minimap shows — 1 fits the whole scene, 2 shows half of it centered on the camera, 4 shows a quarter, so a zoomed map follows the player instead of shrinking a huge level into unreadable dots. The change lasts for the current scene only; the scene's Minimap setting keeps its own zoom. A bad zoom warns and holds.

**Fields:**

- **Zoom** - 1

#### Minimap Visible

True while the minimap is showing for the current scene — gate a map-toggle button or a hint label on it. Evaluates every frame, even while paused.

**Fields:**

- **Invert** (options: Off, On)

### Attach (4)

| Block | Type | What it does |
|---|---|---|
| Attach Object To Object | Action | Attaches the child object to the parent, so it follows the parent at a fixed offset. |
| Detach Object | Action | Detaches the object from whatever it is attached to. |
| Set Attachment Offset | Action | Moves an attached object to a new spacing from its parent. |
| Is Attached | Condition | True while the object is attached to something. |

#### Attach Object To Object

Attaches the child object to the parent, so the child follows the parent everywhere it goes at a fixed offset — a sword in the hero's hand, a hat on a goblin, a name tag above an NPC. The offsets are in world pixels from the parent's top-left corner to the child's; leave them blank to keep the spacing the objects already have. Attaching a child that already has a parent replaces the old link. A blank name, a child attached to itself, or a link that would close a cycle warns and holds; a link to an object that has not spawned yet stays quiet and starts working the frame it appears. Links clear when the scene loads again, so re-attach in a gameStart row.

**Fields:**

- **Child object**
- **Parent object**
- **Offset X** - keep spacing
- **Offset Y** - keep spacing

#### Detach Object

Detaches the object from whatever it is attached to, so it stops following its parent and stays where it is. Quiet when the object is not attached; a blank object warns and holds.

**Fields:**

- **Object**

#### Set Attachment Offset

Moves an attached object to a new spacing from its parent without re-attaching it — slide the sword from the hero's hand to their back, or drop the hat lower on the goblin's head. The offsets are in world pixels from the parent's top-left corner to the child's. Warns and holds when the object is not attached, or when an offset is not a number.

**Fields:**

- **Object**
- **Offset X** - 0
- **Offset Y** - 0

#### Is Attached

True while the object is attached to something — name a parent to ask about that parent only, leave it blank to ask about any parent. Gate a drop-the-sword row or a pick-up prompt on it. A blank object reads as not attached. Evaluates every frame, even while paused.

**Fields:**

- **Object**
- **Parent object (optional)**
- **Invert** (options: Off, On)

### Logic (11)

| Block | Type | What it does |
|---|---|---|
| Chance | Condition | A random roll each frame this condition is evaluated. |
| Distance Check | Condition | Compares center-to-center distance between named objects. |
| Every Frame | Condition | Always true while the preview is running. |
| Mouse Over Object | Condition | Works with camera-follow worlds and fixed UI objects. |
| Object Count | Condition |  |
| Object Visible | Condition |  |
| Position Check | Condition |  |
| Reset / Pause Timer | Action | Controls the named timer used by On Timer blocks. |
| Text Compare | Condition | Compares what a text object currently shows. |
| Trigger Once | Condition | Fires once per preview. Put it next to another condition to gate that condition once. |
| Velocity Check | Condition |  |

#### Chance

A random roll each frame this condition is evaluated.

**Fields:**

- **Percent** - e.g. 5
- **Invert** (options: Off, On)

#### Distance Check

Compares center-to-center distance between named objects.

**Fields:**

- **Object A**
- **Object B**
- **Operator** (options: Within distance, Farther than distance, At least distance, Less than distance)
- **Distance** - e.g. 120 or aggroRange
- **Invert** (options: Off, On)

#### Every Frame

Always true while the preview is running.

#### Mouse Over Object

Works with camera-follow worlds and fixed UI objects.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

#### Object Count

No description yet.

**Fields:**

- **Object**
- **Operator** (options: ==, !=, >=, <=, >, <)
- **Count** - e.g. 0 or targetCount
- **Invert** (options: Off, On)

#### Object Visible

No description yet.

**Fields:**

- **Object**
- **Invert** (options: Off, On)

#### Position Check

No description yet.

**Fields:**

- **Object**
- **Property** (options: X position, Y position, Velocity X, Velocity Y, Width, Height, Rotation, Scale X, Scale Y, Text length)
- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 500 or groundY
- **Invert** (options: Off, On)

#### Reset / Pause Timer

Controls the named timer used by On Timer blocks.

**Fields:**

- **Timer name** - e.g. spawnTimer
- **Action** (options: Reset / start, Pause, Resume, Clear)

#### Text Compare

Compares what a text object currently shows. "Is empty" ignores the Compare-to field. Use it to react when a score label reaches a value or a typewriter finishes.

**Fields:**

- **Object**
- **Compare** (options: Equals, Does not equal, Contains, Starts with, Ends with, Is empty)
- **Compare to** - e.g. Ready
- **Invert** (options: Off, On)

#### Trigger Once

Fires once per preview. Put it next to another condition to gate that condition once.

**Fields:**

- **Invert** (options: Off, On)

#### Velocity Check

No description yet.

**Fields:**

- **Object**
- **Component** (options: Total speed, Velocity X, Velocity Y)
- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1 or maxRunSpeed
- **Invert** (options: Off, On)

### Motion (7)

| Block | Type | What it does |
|---|---|---|
| Face Movement | Action | Rotates an object to point in the direction it is moving. |
| Force Toward Position | Action | For objects using gravity, this keeps gravity active and uses horizontal force plus a grounded jump impulse when the target is above. |
| Impulse Away Object | Action |  |
| Move Toward Object | Action |  |
| Move Toward Position | Action | Moves position directly, useful for UI and non-physics objects. |
| Set Position | Action |  |
| Stop Object | Action |  |

#### Face Movement

Rotates an object to point in the direction it is moving.

**Fields:**

- **Object**
- **Angle offset** - e.g. 0 or 90
- **Speed** - e.g. 0.05

#### Force Toward Position

For objects using gravity, this keeps gravity active and uses horizontal force plus a grounded jump impulse when the target is above.

**Fields:**

- **Object**
- **X** - e.g. 400 or mouseX
- **Y** - e.g. 300 or mouseY
- **Speed** - e.g. 3 or enemySpeed
- **Mode** (options: Instant force, Permanent speed)

#### Impulse Away Object

No description yet.

**Fields:**

- **Object**
- **From**
- **Impulse** - e.g. 8
- **Mode** (options: Add, Set)

#### Move Toward Object

No description yet.

**Fields:**

- **Object**
- **Toward**
- **Speed** - e.g. 4
- **Stop Distance** - e.g. 1

#### Move Toward Position

Moves position directly, useful for UI and non-physics objects.

**Fields:**

- **Object**
- **X** - e.g. 400
- **Y** - e.g. 300
- **Speed** - e.g. 4
- **Stop Distance** - e.g. 1

#### Set Position

No description yet.

**Fields:**

- **Object**
- **X** - e.g. 400 or spawnX
- **Y** - e.g. 300 or spawnY

#### Stop Object

No description yet.

**Fields:**

- **Object**
- **Axis** (options: X and Y, X only, Y only)

### Movement Presets (12)

| Block | Type | What it does |
|---|---|---|
| Dash left | Action |  |
| Dash right | Action |  |
| Fast fall | Action |  |
| High jump | Action |  |
| Move down | Action |  |
| Move left | Action |  |
| Move right | Action |  |
| Move up | Action |  |
| Small jump | Action |  |
| Stop all | Action |  |
| Stop X | Action |  |
| Stop Y | Action |  |

#### Dash left

No description yet.

**Fields:**

- **Object**

#### Dash right

No description yet.

**Fields:**

- **Object**

#### Fast fall

No description yet.

**Fields:**

- **Object**

#### High jump

No description yet.

**Fields:**

- **Object**

#### Move down

No description yet.

**Fields:**

- **Object**

#### Move left

No description yet.

**Fields:**

- **Object**

#### Move right

No description yet.

**Fields:**

- **Object**

#### Move up

No description yet.

**Fields:**

- **Object**

#### Small jump

No description yet.

**Fields:**

- **Object**

#### Stop all

No description yet.

**Fields:**

- **Object**

#### Stop X

No description yet.

**Fields:**

- **Object**

#### Stop Y

No description yet.

**Fields:**

- **Object**

### Object (25)

| Block | Type | What it does |
|---|---|---|
| Append Text | Action | Adds text to the end of what the text object already shows. |
| Bring to Front | Action | Moves the object above every other live object in draw order. |
| Clear Effects | Action | Resets the object's blend mode, shadow, and visual effect back to normal drawing. |
| Flip Object | Action |  |
| Layer Check | Condition | True while a live object with the given name has a draw layer matching the comparison. |
| Move Down a Layer | Action | Lowers the object's draw layer by the given steps. |
| Move Up a Layer | Action | Raises the object's draw layer by the given steps. |
| Pick Farthest | Condition | Picks the furthest live object with the given name from the Near object or X/Y point. |
| Pick Nearest | Condition | Picks the nearest live object with the given name to the Near object or X/Y point. |
| Pick Random | Condition | Picks one random live object with the given name. |
| Point Toward Object | Action |  |
| Point Toward Position | Action |  |
| Send to Back | Action | Moves the object below every other live object in draw order. |
| Set Blend Mode | Action | Changes how the object blends with whatever is drawn under it. |
| Set Color | Action |  |
| Set Layer | Action |  |
| Set Opacity | Action |  |
| Set Scale | Action |  |
| Set Shadow | Action | Gives the object a drop shadow: colored, blurred, drawn at an offset. |
| Set Text Alignment | Action | Aligns the text inside its box: left, center, or right. |
| Set Text Color | Action | Changes the color of text objects. |
| Set Text Size | Action | Changes the font size of text objects. |
| Set Text Style | Action | Turns bold and italic on or off for text objects. |
| Set Visual Effect | Action | Applies a pixel filter to the object: grayscale, sepia, invert, brighten, dim, blur. |
| Spawn At Object | Action |  |

#### Append Text

Adds text to the end of what the text object already shows. Pair with On Timer to build a typewriter effect: every timer tick, append the next letter. Only affects text objects.

**Fields:**

- **Object**
- **Text to add** - e.g. A

#### Bring to Front

Moves the object above every other live object in draw order (its layer becomes the highest layer + 1). The classic way to make a dragged card, an active player, or a popup land on top. Works on the picked object when chained after a pick block.

**Fields:**

- **Object**

#### Clear Effects

Resets the object's blend mode, shadow, and visual effect back to normal drawing — the undo button for Set Blend Mode, Set Shadow, and Set Visual Effect.

**Fields:**

- **Object**

#### Flip Object

Mirrors the object: flip horizontal, flip vertical, flip both, or unflip back to the original facing. Changes only how the object looks; size and collision stay the same.

**Fields:**

- **Object**
- **Direction** (options: Flip horizontal, Flip vertical, Flip both, Unflip (face original way))

#### Layer Check

True while a live object with the given name has a draw layer matching the comparison — for example, ask whether the card is already above the table (Layer at least 5). A plain state read: fires every frame while true, and evaluates while the game is paused.

**Fields:**

- **Object**
- **Compare** (options: at least, at most, equals, not equals, greater than, less than)
- **Layer** - e.g. 1
- **Invert** (options: Off, On)

#### Move Down a Layer

Lowers the object's draw layer by the given steps (default 1), so whatever was just below it now draws on top.

**Fields:**

- **Object**
- **Steps** - e.g. 1

#### Move Up a Layer

Raises the object's draw layer by the given steps (default 1), so it draws over whatever sat just above it. Handy when objects shuffle order often, like stacked cards or inventory slots.

**Fields:**

- **Object**
- **Steps** - e.g. 1

#### Pick Farthest

Picks the furthest live object with the given name from the Near object (leave Near object blank to measure from the X/Y point instead). An action chained after this block with the same Object name applies only to the picked object — "the furthest zombie flees", spread-out spawns. True while at least one live object with the name exists; stays quiet otherwise.

**Fields:**

- **Object**
- **Near object**
- **Point X** - e.g. 400
- **Point Y** - e.g. 300

#### Pick Nearest

Picks the nearest live object with the given name to the Near object (leave Near object blank to measure from the X/Y point instead). An action chained after this block with the same Object name applies only to the picked object — enemy AI targeting, homing pickups, "the closest coin flashes". True while at least one live object with the name exists; stays quiet otherwise.

**Fields:**

- **Object**
- **Near object**
- **Point X** - e.g. 400
- **Point Y** - e.g. 300

#### Pick Random

Picks one random live object with the given name. An action chained after this block with the same Object name applies only to the picked object — random loot drops, surprise spawns, "one enemy charges". Fires once per appearance by default; switch the trigger mode to "While true" for a fresh random pick every frame.

**Fields:**

- **Object**

#### Point Toward Object

No description yet.

**Fields:**

- **Object**
- **Toward**
- **Angle offset** - e.g. 0 or 90

#### Point Toward Position

No description yet.

**Fields:**

- **Object**
- **X** - e.g. 400
- **Y** - e.g. 300
- **Angle offset** - e.g. 0 or 90

#### Send to Back

Moves the object below every other live object in draw order (its layer becomes the lowest layer - 1). Put a background prop behind everything else without hunting for the right layer number.

**Fields:**

- **Object**

#### Set Blend Mode

Changes how the object blends with whatever is drawn under it. Add makes bright colors glow over dark backgrounds (lasers, fireflies, light rays); Multiply darkens like stained glass. Drawing-only — collision is untouched.

**Fields:**

- **Object**
- **Blend** (options: Normal, Add (glow), Multiply, Screen, Overlay, Difference)

#### Set Color

No description yet.

**Fields:**

- **Object**
- **Color**

#### Set Layer

No description yet.

**Fields:**

- **Object**
- **Layer** - e.g. 1 or score

#### Set Opacity

No description yet.

**Fields:**

- **Object**
- **Opacity** - e.g. 0.5

#### Set Scale

Scales how big the object looks: 1 is normal, 2 is twice as big, 0.5 is half. Scale changes only the drawing, not the collision box — the hitbox keeps using the object's width and height, so use Set Size when the collision must change too.

**Fields:**

- **Object**
- **Scale X** - e.g. 1
- **Scale Y** - e.g. 1

#### Set Shadow

Gives the object a drop shadow: a colored, blurred copy drawn underneath at the offset. Blur runs 0-64; a blur of 0 turns the shadow off. Drawing-only — collision is untouched.

**Fields:**

- **Object**
- **Shadow color**
- **Blur** - e.g. 8
- **Offset X** - e.g. 0
- **Offset Y** - e.g. 4

#### Set Text Alignment

Aligns the text inside its box: left, center, or right. Only affects text objects; everything else is left alone.

**Fields:**

- **Object**
- **Alignment** (options: Left, Center, Right)

#### Set Text Color

Changes the color of text objects. Only affects text objects; everything else is left alone.

**Fields:**

- **Object**
- **Color**

#### Set Text Size

Changes the font size of text objects. Only affects text objects; everything else is left alone.

**Fields:**

- **Object**
- **Size** - e.g. 24 or titleSize

#### Set Text Style

Turns bold and italic on or off for text objects. Only affects text objects; everything else is left alone.

**Fields:**

- **Object**
- **Bold** (options: Bold, Not bold)
- **Italic** (options: Italic, Not italic)

#### Set Visual Effect

Applies a pixel filter to the object: turn the world grayscale in a flashback, invert colors for a glitch moment, dim a paused scene. Choose None to switch the filter off. Drawing-only — collision is untouched.

**Fields:**

- **Object**
- **Effect** (options: None, Grayscale, Sepia, Invert colors, Brighten, Dim, Soft blur)

#### Spawn At Object

No description yet.

**Fields:**

- **Object**
- **At**
- **Offset X** - e.g. 0 or player.width
- **Offset Y** - e.g. 0

### Organization (1)

| Block | Type | What it does |
|---|---|---|
| Comment | Note | Editor-only note. It never runs in preview. |

#### Comment

Editor-only note. It never runs in preview.

**Fields:**

- **Comment** - e.g. What this event does...

### Particles (4)

| Block | Type | What it does |
|---|---|---|
| Emit Burst | Action | Fires a one-shot burst of particles (explosion, sparkle, smoke, confetti...) |
| Start Emitter | Action | Starts a continuous particle emitter (fire, rain, snow, magic trail...) |
| Stop Emitter | Action | Stops a running emitter by name (blank = all) |
| Clear Particles | Action | Removes live particles instantly (blank = everything) |

#### Emit Burst

Fires a one-shot burst of particles: an explosion, sparkle, smoke puff, confetti, or your own custom burst. Pick a preset, then tweak the fields. Works in preview and in exported games.

**Fields:**

- **Preset** (Explosion, Sparkle, Smoke puff, Confetti, Splash, Custom)
- **X** - an expression, like `0` or `hero.posX`
- **Y** - an expression, like `0` or `hero.posY`
- **Count**
- **Speed (px/sec)**
- **Spread (degrees)**
- **Direction** - 0 = right, 90 = down, 180 = left, 270 = up
- **Lifetime (seconds)**
- **Start size / End size (px)**
- **Start color / End color**
- **Gravity (px/sec, negative = rises)**
- **Shape** - Circle / Square
- **Additive glow** toggle

#### Start Emitter

Starts a continuous particle emitter (fire, rain, snow, a magic trail...). Give it a name; set Follow object to make it track an object, like a rocket trail. Starting an emitter with an existing name replaces it. Emitters are per-scene: a new scene starts with a clean slate. Works in preview and in exported games.

**Fields:**

- **Emitter name**
- **Follow object (optional)** - None (fixed position), or a named object
- **Preset** (Fire, Magic trail, Rain, Snow, Fountain, Custom)
- **Rate (particles/sec)**
- **X / Y** - expressions for the emitter position
- **Speed (px/sec)**
- **Spread (degrees)**
- **Direction** - 0 = right, 90 = down, 180 = left, 270 = up
- **Lifetime (seconds)**
- **Start size / End size (px)**
- **Start color / End color**
- **Gravity (px/sec, negative = rises)**
- **Shape** - Circle / Square
- **Additive glow** toggle

#### Stop Emitter

Stops a running emitter by name. Leave the name blank to stop every emitter. Particles already in flight finish their lifetimes. Works in preview and in exported games.

**Fields:**

- **Emitter name (blank = all)**

#### Clear Particles

Removes live particles instantly: one emitter's, or everything when the name is blank. Emitters keep running unless you also stop them. Works in preview and in exported games.

**Fields:**

- **Emitter name (blank = everything)**

### Physics Presets (24)

| Block | Type | What it does |
|---|---|---|
| bullet friction | Action |  |
| bullet gravity | Action |  |
| bullet max speed | Action |  |
| floaty friction | Action |  |
| floaty gravity | Action |  |
| floaty max speed | Action |  |
| heavy friction | Action |  |
| heavy gravity | Action |  |
| heavy max speed | Action |  |
| ice friction | Action |  |
| ice gravity | Action |  |
| ice max speed | Action |  |
| low-gravity friction | Action |  |
| low-gravity gravity | Action |  |
| low-gravity max speed | Action |  |
| platformer friction | Action |  |
| platformer gravity | Action |  |
| platformer max speed | Action |  |
| top-down friction | Action |  |
| top-down gravity | Action |  |
| top-down max speed | Action |  |
| vehicle friction | Action |  |
| vehicle gravity | Action |  |
| vehicle max speed | Action |  |

#### bullet friction

No description yet.

**Fields:**

- **Object**

#### bullet gravity

No description yet.

**Fields:**

- **Object**

#### bullet max speed

No description yet.

**Fields:**

- **Object**

#### floaty friction

No description yet.

**Fields:**

- **Object**

#### floaty gravity

No description yet.

**Fields:**

- **Object**

#### floaty max speed

No description yet.

**Fields:**

- **Object**

#### heavy friction

No description yet.

**Fields:**

- **Object**

#### heavy gravity

No description yet.

**Fields:**

- **Object**

#### heavy max speed

No description yet.

**Fields:**

- **Object**

#### ice friction

No description yet.

**Fields:**

- **Object**

#### ice gravity

No description yet.

**Fields:**

- **Object**

#### ice max speed

No description yet.

**Fields:**

- **Object**

#### low-gravity friction

No description yet.

**Fields:**

- **Object**

#### low-gravity gravity

No description yet.

**Fields:**

- **Object**

#### low-gravity max speed

No description yet.

**Fields:**

- **Object**

#### platformer friction

No description yet.

**Fields:**

- **Object**

#### platformer gravity

No description yet.

**Fields:**

- **Object**

#### platformer max speed

No description yet.

**Fields:**

- **Object**

#### top-down friction

No description yet.

**Fields:**

- **Object**

#### top-down gravity

No description yet.

**Fields:**

- **Object**

#### top-down max speed

No description yet.

**Fields:**

- **Object**

#### vehicle friction

No description yet.

**Fields:**

- **Object**

#### vehicle gravity

No description yet.

**Fields:**

- **Object**

#### vehicle max speed

No description yet.

**Fields:**

- **Object**

### Scene (6)

| Block | Type | What it does |
|---|---|---|
| Go To Next Scene | Action |  |
| Go To Previous Scene | Action |  |
| Restart Scene | Action |  |
| Push Scene | Action | Switches to a scene but remembers the return scene; Pop Scene comes back |
| Pop Scene | Action | Returns to the scene that Push Scene came from |
| Set Scene Background | Action | Recolors the current scene behind everything |

#### Go To Next Scene

No description yet.

#### Go To Previous Scene

No description yet.

#### Restart Scene

No description yet.

#### Push Scene

**Fields:**

- **Scene to show** (scene picker)

Switches to the picked scene but remembers the current scene on a scene stack, so **Pop Scene** can return to it. Like every scene change, the switch happens at the end of the frame. Up to 16 scenes can be stacked; pushing the 17th is ignored with a warning. Pushing the current scene or a scene that no longer exists does nothing. Note: only the scene id is remembered — the old scene's objects re-instantiate when you come back.

#### Pop Scene

Returns to the scene that **Push Scene** came from. Does nothing (with a warning) when no scene was pushed.

#### Set Scene Background

**Fields:**

- **Background color** (color picker)

Recolors the current scene behind everything, right away. A scene background image, when one is set, still draws on top of the color. Invalid colors are ignored with a warning.

### Storage (6)

| Block | Type | What it does |
|---|---|---|
| Load Variable | Action |  |
| Save Variable | Action |  |
| Save Game | Action | Saves all game variables into a named save slot |
| Load Game | Action | Restores all variables from a named save slot |
| Delete Save | Action | Clears a named save slot |
| Save Slot Exists | Condition | True when a named save slot holds a saved game |

#### Load Variable

No description yet.

**Fields:**

- **Variable** - e.g. bestScore
- **Key** - e.g. bestScore

#### Save Variable

No description yet.

**Fields:**

- **Variable** - e.g. bestScore
- **Key** - e.g. bestScore

#### Save Game

Saves ALL game variables into a named save slot (your browser's memory card). Use it for progress, unlocked levels, and high scores. Works in the preview and in exported games.

**Fields:**

- **Slot name** - e.g. Slot 1

#### Load Game

Restores all variables saved in the named slot. Does nothing if the slot is empty — pair it with Save Slot Exists to check first.

**Fields:**

- **Slot name** - e.g. Slot 1

#### Delete Save

Clears the named save slot. Use it for a "New Game" button that wipes old progress.

**Fields:**

- **Slot name** - e.g. Slot 1

#### Save Slot Exists

True when the named slot holds a saved game. Great on a title screen: saved game found → show Continue; no save → show New Game.

**Fields:**

- **Slot name** - e.g. Slot 1
- **Invert** - Off / On

### Variables (44)

| Block | Type | What it does |
|---|---|---|
| Push To Array | Action | Adds the value to the end of the list |
| Pop From Array | Action | Removes the last item; optionally stores it in another variable |
| Set Array Item | Action | Replaces the item at the index; grows the list with 0s past the end |
| Get Array Item | Action | Copies the item at the index into another variable |
| Insert Into Array | Action | Inserts the value at the index, shifting later items right |
| Remove Array Item | Action | Removes the item at the index; optionally stores it |
| Remove Array Value | Action | Removes the first item exactly equal to the value |
| Clear Array | Action | Empties the list |
| Sort Array | Action | Sorts the list in place: numbers or text, ascending or descending |
| Shuffle Array | Action | Randomly reorders the list in place |
| Join Array To Text | Action | Glues the items into one text with a separator |
| Array Total | Action | Stores the sum, average, minimum, or maximum of the list |
| Array Length | Condition | True when the item count matches the comparison |
| Array Contains | Condition | True when the list holds an item exactly equal to the value |
| Set Structure Field | Action | Sets a named field on the structure |
| Get Structure Field | Action | Copies the field into another variable |
| Remove Structure Field | Action | Deletes the named field from the structure |
| Clear Structure | Action | Removes every field from the structure |
| List Structure Keys | Action | Stores the field names as a new list |
| Structure Has Field | Condition | True when the structure has the named field |
| Variable To JSON | Action | Turns any variable into JSON text |
| Variable From JSON | Action | Rebuilds a variable from JSON text |
| Get Nested Value | Action | Reads a value deep inside a list or structure into another variable |
| Set Nested Value | Action | Writes a value deep inside a list or structure |
| Store Object In Structure | Action | Stores the object a scoped variable holds inside a list or structure at a path |
| Read Object From Structure | Action | Reads the object at a path inside a list or structure back into a scoped variable |
| Random Integer | Action | Stores a whole number between Min and Max, inclusive |
| Clamp Number | Action | Forces the variable into the Minimum..Maximum range |
| Round Number | Action | Rounds the variable and writes it back |
| Random Pick | Action | Copies a random item from a list into another variable |
| Number In Range | Condition | True while the value sits between Minimum and Maximum |
| Set Scoped Variable | Action | Stores a value in one scope: Global, Scene, or Object |
| Read Scoped Variable | Action | Copies a scoped variable into an ordinary variable |
| Read Text Into Variable | Action | Reads what a text object shows into an ordinary variable |
| Delete Scoped Variable | Action | Deletes one scoped variable |
| Clear Scoped Variables | Action | Clears a whole scope at once |
| Scoped Variable Exists | Condition | True while the named variable exists in the picked scope |
| Scoped Variable Check | Condition | True while a scoped variable compares with the value the picked way |
| Pick Object Into Variable | Action | Picks one live object and stores it in a scoped variable |
| Read Object Property | Action | Reads one property of the held object into an ordinary variable |
| Raycast Into Variables | Action | Casts a ray and stores the hit object and the distance to it |
| List Overlapping Objects | Action | Lists every live collision object inside a circle into a list variable |
| Spawn Object Into Variable | Action | Spawns a copy of the object and stores the clone in a scoped variable |
| Destroy Object In Variable | Action | Destroys exactly the object a variable holds |

Any game variable can hold a list or a structure. Indexes start at 0; -1 is the last item. Reading past the end gives 0. Blocks create the container on first write; conditions never create variables. Value fields take a **Value is** kind: Number (expression), Text, True, False, or Copy of another variable (deep copy). A **path** walks through nested containers in one block: `party[0].hp` reads the hp field of the first dictionary in the party list, `player.stats.hp` reads a field of a field, and `[0].name` reads from a list root. A nested write builds the lists and structures it needs on the way down (a list step grows the list with 0s, a field step creates the dictionary), so a list of dictionaries can grow one path write at a time. A missing step on a read gives 0, and a blank or malformed path warns and holds.

Scoped variables add a second layer on top of the flat variables above: every scoped variable lives in exactly one scope — **Global** (the whole run, every scene), **Scene** (this scene only; it resets when the scene loads), or **Object** (one value per object name, so two goblins can each keep their own hp). A fourth scope, **Local**, belongs to function calls: it holds the parameters a function was called with, and only the running call can see it. Every value carries a type — number, text, true/false, list, dict, or object — inferred from the value written. A missing scoped variable reads as 0 through the Read block and as "does not exist" through the conditions. The object scope needs a name, not a live object: the object NAME is the key, so a row can set a variable for an enemy before it ever spawns. An object value is a reference to one live object, kept by name and id: **Pick Object Into Variable** stores one, and **Read Object Property** reads its position, size, velocity, health, name, or whether it is still alive back into an ordinary variable. Two physics queries write the same kind of value: **Raycast Into Variables** stores the closest object a ray hits, plus the distance to it, and **List Overlapping Objects** stores every object inside a circle as a list of references, so For Each Item can walk through them one at a time and act on each one. Spawn and destroy work the same way: **Spawn Object Into Variable** spawns a copy of an object and stores the clone as a reference, so the game can keep track of one spawned enemy and act on only that one, and **Destroy Object In Variable** destroys exactly the object a variable holds, not every object with that name. A spawn of a missing source clears the variable, so it never holds a stale clone.

#### Push To Array

Adds the value to the end of the list. Creates the list if the variable does not hold one yet.

**Fields:**

- **List variable** - e.g. inventory
- **Value is** (Number (expression) / Text / True / False / Copy of another variable)
- **Value** - e.g. 1, score + 1, or item name

#### Pop From Array

Removes the last item of the list. Optionally stores it in another variable (0 when the list is empty).

**Fields:**

- **List variable** - e.g. inventory
- **Into variable (optional)** - e.g. pickedItem

#### Set Array Item

Replaces the item at the index (0 is first, -1 is last). Grows the list with 0s when the index is past the end.

**Fields:**

- **List variable** - e.g. inventory
- **Index** - e.g. 0 (first), -1 (last)
- **Value is** (Number (expression) / Text / True / False / Copy of another variable)
- **Value** - e.g. 1, score + 1, or item name

#### Get Array Item

Copies the item at the index into another variable (0 when the index is out of range). Use the copied variable in expressions.

**Fields:**

- **List variable** - e.g. inventory
- **Index** - e.g. 0 (first), -1 (last)
- **Into variable** - e.g. pickedItem

#### Insert Into Array

Inserts the value at the index, shifting later items one step right.

**Fields:**

- **List variable** - e.g. inventory
- **Index** - e.g. 0 (first), -1 (last)
- **Value is** (Number (expression) / Text / True / False / Copy of another variable)
- **Value** - e.g. 1, score + 1, or item name

#### Remove Array Item

Removes the item at the index. Optionally stores the removed item in another variable.

**Fields:**

- **List variable** - e.g. inventory
- **Index** - e.g. 0 (first), -1 (last)
- **Into variable (optional)** - e.g. removedItem

#### Remove Array Value

Removes the first item that exactly equals the value. Does nothing when the value is not in the list.

**Fields:**

- **List variable** - e.g. inventory
- **Value is** (Number (expression) / Text / True / False / Copy of another variable)
- **Value** - e.g. 1, score + 1, or item name

#### Clear Array

Empties the list. The variable still holds a list, just with no items.

**Fields:**

- **List variable** - e.g. inventory

#### Sort Array

Sorts the list in place. Number sorts treat non-numbers as 0; text sorts compare as text.

**Fields:**

- **List variable** - e.g. scores
- **Sort by** (Numbers, low to high / Numbers, high to low / Text, A to Z / Text, Z to A)

#### Shuffle Array

Randomly reorders the list in place. The classic card-deck shuffle.

**Fields:**

- **List variable** - e.g. deck

#### Join Array To Text

Glues every item into one text with the separator between items, and stores it. Show it with Set Text.

**Fields:**

- **List variable** - e.g. inventory
- **Separator** - e.g. ,
- **Into variable** - e.g. inventoryText

#### Array Total

Computes the sum, average, minimum, or maximum of the list (non-numbers count as 0) and stores the result. An empty list gives 0.

**Fields:**

- **List variable** - e.g. scores
- **Compute** (Sum / Average / Minimum / Maximum)
- **Into variable** - e.g. total

#### Array Length

True when the number of items in the list matches the comparison. A missing variable counts as an empty list.

**Fields:**

- **List variable** - e.g. inventory
- **Compare** (at least / at most / equals / not equals / greater than / less than)
- **Value** - e.g. 1
- **Invert** (On/Off)

#### Array Contains

True when the list holds an item exactly equal to the value. Invert it to ask "does the player NOT have the key yet?".

**Fields:**

- **List variable** - e.g. inventory
- **Value is** (Number (expression) / Text / True / False / Copy of another variable)
- **Value** - e.g. 1, score + 1, or item name
- **Invert** (On/Off)

#### Set Structure Field

Sets a named field on the structure (player.gold = 50). Creates the structure if the variable does not hold one yet.

**Fields:**

- **Structure variable** - e.g. player
- **Field name** - e.g. gold
- **Value is** (Number (expression) / Text / True / False / Copy of another variable)
- **Value** - e.g. 1, score + 1, or item name

#### Get Structure Field

Copies the field into another variable (0 when the field is missing). Use the copied variable in expressions.

**Fields:**

- **Structure variable** - e.g. player
- **Field name** - e.g. gold
- **Into variable** - e.g. gold

#### Remove Structure Field

Deletes the named field from the structure. Does nothing when the field is not there.

**Fields:**

- **Structure variable** - e.g. player
- **Field name** - e.g. gold

#### Clear Structure

Removes every field from the structure. The variable still holds a structure, just with no fields.

**Fields:**

- **Structure variable** - e.g. player

#### List Structure Keys

Stores the list of field names as a new list variable. Handy with Array Length and Join Array To Text.

**Fields:**

- **Structure variable** - e.g. player
- **Into variable** - e.g. fieldNames

#### Structure Has Field

True when the structure has the named field. A missing variable counts as having no fields.

**Fields:**

- **Structure variable** - e.g. player
- **Field name** - e.g. gold
- **Invert** (On/Off)

#### Variable To JSON

Turns any variable (list, structure, number, text) into JSON text. Pairs with Variable From JSON to rebuild it.

**Fields:**

- **Variable** - e.g. player
- **Into variable** - e.g. playerJson

#### Variable From JSON

Rebuilds a variable from JSON text (the reverse of Variable To JSON). Invalid JSON warns and leaves the variable unchanged.

**Fields:**

- **Variable** - e.g. player
- **JSON text** - e.g. {"gold": 0}

#### Get Nested Value

Reads a value deep inside a list or structure into another variable: `party[0].hp` reads the hp field of the first dictionary in the party list, `player.stats.hp` reads a field of a field. A missing step reads as 0. A blank or malformed path warns and nothing is stored.

**Fields:**

- **Variable** - e.g. party
- **Path** - e.g. [0].name or stats.hp
- **Into variable** - e.g. firstName

#### Set Nested Value

Writes a value deep inside a list or structure: `party[0].hp = 10`. Builds the lists and structures it needs on the way down (a list step grows the list with 0s, a field step creates the dictionary), so a list of dictionaries can grow one path write at a time. An index past the 10000 cap warns and nothing changes. A blank or malformed path warns and nothing changes.

**Fields:**

- **Variable** - e.g. party
- **Path** - e.g. [0].hp or stats.hp
- **Value is** - Number (expression), Text, True, False, or Copy of another variable
- **Value** - e.g. 10

#### Store Object In Structure

Stores the object a scoped variable holds inside a list or structure at a path: `squad[0]` stores it in the first slot of the squad list, `party.leader` stores it in the leader field. Builds the lists and structures it needs on the way down, like Set Nested Value, so a squad list of live objects grows one store at a time. A variable that holds no object stores the empty reference, so a later Is alive read is 0. A blank variable name, blank path, blank object variable, or object scope with no object warns and nothing changes. An index past the 10000 cap warns and nothing changes.

**Fields:**

- **Variable** - e.g. squad
- **Path** - e.g. [0] or leader
- **Object variable** - e.g. member
- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Scope object**

#### Read Object From Structure

Reads the object at a path inside a list or structure back into a scoped variable: `squad[0]` reads the first member of the squad list, `party.leader` reads the leader field. A missing step, or a value that is not an object, clears the variable, so a later Is alive read is 0 and the variable never holds a stale member. The read also points the execution context at the live object, like the pick, so actions chained after it that target the same object name hit that one object. A blank variable name, blank path, blank object variable, or object scope with no object warns and nothing is stored.

**Fields:**

- **Variable** - e.g. squad
- **Path** - e.g. [0] or leader
- **Object variable** - e.g. member
- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Scope object**

#### Random Integer

Stores a whole number between Min and Max, inclusive on both ends. Min and Max swap automatically when Min is bigger.

**Fields:**

- **Into variable** - e.g. roll
- **Min** - e.g. 1
- **Max** - e.g. 6

#### Clamp Number

Forces the variable into the Minimum..Maximum range (health that cannot pass 100 or drop below 0). Writes the result back into the same variable.

**Fields:**

- **Number variable** - e.g. health
- **Minimum** - e.g. 0
- **Maximum** - e.g. 100

#### Round Number

Rounds the variable and writes the result back into it. Use for score displays and tidy HUD numbers.

**Fields:**

- **Number variable** - e.g. score
- **Round to** (Whole number / Down (floor) / Up (ceiling) / 1 decimal place / 2 decimal places)

#### Random Pick

Copies a random item from the list into another variable. Writes 0 when the list is empty or missing.

**Fields:**

- **From list** - e.g. deck
- **Into variable** - e.g. drawnCard

#### Number In Range

True while the value sits between Minimum and Maximum, inclusive. A state read, so it stays true every frame the value is in range.

**Fields:**

- **Value** - e.g. score
- **Minimum** - e.g. 0
- **Maximum** - e.g. 100
- **Invert** (Off / On)

#### Set Scoped Variable

Stores a value in one scope: Global keeps it for the whole run, Scene keeps it for this scene only (it resets when the scene loads), Object keeps one value per object name. The type follows the value — number, text, true/false, or a copy of another variable. A blank name warns and holds; a bad number expression warns and holds; the object scope with no object picked warns and holds.

**Fields:**

- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Object**
- **Variable name** - e.g. coins
- **Value is** (Number (expression) / Text / True / False / Copy of another variable)
- **Value** - e.g. 1, score + 1, or item name

#### Read Scoped Variable

Copies a scoped variable into an ordinary flat variable, so expressions, labels, and the old variable blocks can use it. A missing variable reads as 0. A blank target name warns and holds.

**Fields:**

- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Object**
- **Variable name** - e.g. coins
- **Into variable** - e.g. coinsHere

#### Read Text Into Variable

Reads what a text object shows into an ordinary flat variable, so the game can use text the player typed: digit keys + Append Text build the text up in the object, this block reads it back out. Number mode parses the text (a blank reads as 0, text that is not a number warns and leaves the variable alone); Text mode stores the text as-is. A blank variable name, a blank object, or an object that is not text warns and holds. The read does not stop the chain: a later Set Scoped Variable with "Copy of another variable" still runs and reads a missing flat variable as 0.

**Fields:**

- **Text object**
- **Read as** (Text (as shown) / Number (parse digits))
- **Into variable** - e.g. typedValue

#### Delete Scoped Variable

Deletes one scoped variable. Does nothing when the variable is not there. A blank name warns and holds.

**Fields:**

- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Object**
- **Variable name** - e.g. coins

#### Clear Scoped Variables

Clears a whole scope at once: every global variable, this scene's variables, or one object's variables (leave Object blank to clear every object's).

**Fields:**

- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Object (blank = every object)**

#### Scoped Variable Exists

True while the named variable exists in the picked scope. Invert it to run a row only the first time — set the variable at the end of the row so it never fires twice. A state read, so it stays true every frame the variable exists, even while paused.

**Fields:**

- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Object**
- **Variable name** - e.g. coins
- **Invert** (Off / On)

#### Scoped Variable Check

True while a scoped variable compares with the value the picked way. Numbers compare numerically; text and true/false compare as text. A missing variable reads as 0. A list or dict never matches ==. A state read, so it stays true every frame the comparison holds, even while paused.

**Fields:**

- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Object**
- **Variable name** - e.g. coins
- **Compare** (at least / at most / equals / not equals / greater than / less than)
- **Value** - e.g. 1
- **Invert** (Off / On)

#### Pick Object Into Variable

Picks one live object and stores it in a scoped variable, so the game can keep track of one enemy, one coin, one bullet and use it later. Nearest and Farthest measure from the Near object when one is named, otherwise from the X/Y point; Random and First need no reference. The pick also points the execution context at the picked object, so actions chained after it that target the same object name hit only the picked object. No live object stays quiet and writes nothing; a blank object or variable name warns and holds, and the object scope with no object picked warns and holds.

**Fields:**

- **Object**
- **Pick** (Nearest / Farthest / Random / First)
- **Near object (optional)**
- **X** - e.g. 0
- **Y** - e.g. 0
- **Into variable** - e.g. target
- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Scope object**

#### Read Object Property

Reads one property of the object a variable holds into an ordinary variable, so expressions and labels can use it: where the picked enemy stands, how fast it moves, how much health it has left. Is alive reads 1 while the held object is still live and 0 when it is gone, so it is the liveness test. A missing variable, a variable that holds no object, or a stale object (destroyed, or a clone left behind by a scene switch) reads as 0, or empty text for Name, and stays quiet. A blank object variable or target name warns and holds.

**Fields:**

- **Object variable** - e.g. target
- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Scope object**
- **Property** (X position / Y position / Width / Height / Rotation (degrees) / Velocity X / Velocity Y / Health / Max Health / Name (text) / Is alive (1 or 0))
- **Into variable** - e.g. targetX

#### Raycast Into Variables

Casts a ray from the From point to the To point and stores what it hits: the closest live collision object goes into a scoped object variable, and the distance to the hit goes into an ordinary variable. Actions chained after it that target the same object name hit only the hit object. A miss writes -1 for the distance and clears the object variable, so a later Is alive read is 0 and the variable never holds a stale hit. A blank object variable or an object scope with no object warns and holds; a blank distance variable only skips the distance store. Bad coordinates warn and hold.

**Fields:**

- **From X** - e.g. 0
- **From Y** - e.g. 0
- **To X** - e.g. 400
- **To Y** - e.g. 300
- **Layers (mask)** - e.g. 255 = all
- **Into variable** - e.g. hit
- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Scope object**
- **Distance variable** - e.g. hitDistance

#### List Overlapping Objects

Lists every live collision object overlapping the circle at X/Y with the given radius and stores them as a list of object handles, so For Each Item can walk through them one at a time: each round the body reads the current object's properties with Read Object Property and its actions hit that one object. The list is replaced fresh on every run, never added to. An empty overlap stores an empty list and a count of 0 and stays quiet. A blank list variable warns and holds; a blank count variable only skips the count store. Bad coordinates or a bad radius warn and hold; a negative radius reads as 0.

**Fields:**

- **X** - e.g. 400
- **Y** - e.g. 300
- **Radius** - e.g. 48
- **Layers (mask)** - e.g. 255 = all
- **Into list** - e.g. nearby
- **Count variable** - e.g. nearbyCount

#### Spawn Object Into Variable

Spawns a copy of the object at X/Y and stores the clone in a scoped object variable, so the game can keep track of one spawned enemy, one bullet, one coin and use it later. Actions chained after it that target the same object name hit only the clone. A missing source clears the variable, so a later Is alive read is 0 and the variable never holds a stale clone. A blank object or variable name warns and holds, and an object scope with no object picked warns and holds. A blank X or Y spawns at the source's own position, like Spawn Object.

**Fields:**

- **Object**
- **X** - e.g. 400
- **Y** - e.g. 300
- **Into variable** - e.g. spawned
- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Scope object**

#### Destroy Object In Variable

Destroys exactly the object a variable holds — the clone a spawn handed back, or the goblin a pick chose — not every object with that name. A missing variable, a variable that holds no object, or an object that is already gone stays quiet. A blank variable name warns and holds, and an object scope with no object picked warns and holds.

**Fields:**

- **Object variable** - e.g. spawned
- **Scope** (Global (whole game) / Scene (this scene only) / Object (per object name))
- **Scope object**

### Functions (2)

| Block | Type | What it does |
|---|---|---|
| Call Function | Action | Runs a named function once and stores its return value |
| Return From Function | Action | Hands a value back to the caller and stops the function body |

A function is a named chain of blocks you write once and call from anywhere: define it in the Functions tab of the Scene inspector (name, up to eight parameters, and a body grid like any other scope), then call it with Call Function. The Call Function panel shows one argument field per parameter, labeled with the parameter name. The parameters arrive as local variables — a fourth scope, Local, that only the running call can see — so the same function can add 3 + 4 one moment and 10 + 20 the next, and each call gets its own fresh locals. Return From Function hands a value back to the caller and stops the rest of the body; a function with no Return returns 0. A function body never runs on its own — only when Call Function names it — and a gameStart block inside a body fires only on the first call of the run. Calls nest, and a function can call itself, but the stack caps at 32 deep: the 33rd call is skipped with a warning and returns 0. The diagnostics panel checks function bodies like any other grid, and flags a Call Function that names a function that does not exist, or a Return From Function placed outside a function body.

#### Call Function

Runs the named function once, left to right through its body grid, and stores the return value in an ordinary variable (leave it blank to throw the value away).

**Fields:**

- **Function** - the function to run, picked from the Functions manager
- **Arg 1** - **Arg 4** - expressions passed in as the parameters, in order; a blank argument ends the list
- **Into variable (optional)** - e.g. result

#### Return From Function

Hands the value back to the caller and stops the rest of the body — no later row in the body runs. Only works inside a function body; used anywhere else it warns and does nothing.

**Fields:**

- **Value** - e.g. sum

### Control Flow (10)

| Block | Type | What it does |
|---|---|---|
| Repeat | Action | Runs the blocks to its right a set number of times |
| While | Action | Runs the blocks to its right while its test holds |
| Break | Action | Stops the innermost loop at once |
| Continue | Action | Skips the rest of this round and starts the next one |
| For Each Item | Action | Runs the blocks to its right once per item of a list |
| For Each Object | Action | Runs the blocks to its right once per live object with a name |
| For Each Field | Action | Runs the blocks to its right once per field of a structure |
| For Each Tagged Object | Action | Runs the blocks to its right once per live object carrying a tag |
| Broadcast Event | Action | Sends a named event to every On Event listener with that name |
| On Event | Condition | True for one frame when the named event is broadcast |

A loop block sits at the head of a row and the actions to its right on the same row are its body — Repeat runs the body a set number of times, While runs it until its test stops holding, For Each Item runs it once per item of a list, For Each Object runs it once per live object with a name, For Each Tagged Object runs it once per live object carrying a tag, whatever the members are called, For Each Field runs it once per field of a structure, handing the body the key and the value each round, and Break / Continue steer the innermost loop from inside the body. The body stays ordinary blocks, never hidden inside the loop: put the trigger condition above the loop block, the loop block at the head of its row, and the body to its right. A condition, an empty cell, or the row end stops the body. Loops nest, and a loop body can call a function or hold another loop. Three safety caps keep a bad loop from freezing the game: Repeat clamps to 1000 times (and says so), While stops after 1000 times when its test is still true, For Each Item, For Each Object, For Each Tagged Object, and For Each Field run at most the first 1000 items, objects, or fields (and say so), and loops nest at most 8 deep. A per-frame budget of 10,000 body actions bounds nested loops as well. Repeat counts from 1: its counter variable, when named, reads 1 on the first time round, 2 on the second, up to the count. While has no counter of its own — change a variable inside the body and test that variable. A loop body runs all at once inside one frame, so a While that waits on a key press or a timer will never see it change mid-loop; test a variable the body itself changes instead. For Each Item reads a flat list variable, the one the array blocks build; a dict is not a list, so it warns and holds instead of walking its keys — walk a dict with For Each Field instead. For Each Object hands the body the current object through action targeting only — the body cannot read the object's position into a variable yet; object references as values come later. For Each Tagged Object hands the body the current object the same way, and when its Object variable is named it also holds the current object there, so Read Object Property can read it even when the tagged objects have different names.

#### Repeat

Runs the blocks to its right on the same row over and over, the set number of times.

**Fields:**

- **Times** - e.g. 3
- **Counter variable (optional)** - e.g. i, counts the time round from 1

#### While

Runs the blocks to its right on the same row over and over while the test holds, and stops the moment it stops holding.

**Fields:**

- **Left value** - e.g. score
- **Compare** (at least / at most / equals / not equals / greater than / less than)
- **Right value** - e.g. 10

#### Break

Stops the innermost loop at once, and the game carries on after the loop. Outside a loop it warns and does nothing.

#### Continue

Skips the rest of this time round the innermost loop and starts the next one. Outside a loop it warns and does nothing.

#### For Each Item

Runs the blocks to its right on the same row once for every item in the list. The list is snapshotted at the start, so a body that pushes or pops does not change the run.

**Fields:**

- **List variable** - e.g. inventory, the list the array blocks build
- **Item variable** - e.g. item, holds the item each time round
- **Index variable (optional)** - e.g. index, counts 1, 2, 3

#### For Each Object

Runs the blocks to its right on the same row once for every live object with that name, in live order. Body actions that target the object hit one object at a time, the current one. The objects are snapshotted at the start, so a body that destroys one cannot shift the run.

**Fields:**

- **Object** - e.g. coin
- **Index variable (optional)** - e.g. index, counts 1, 2, 3

#### For Each Field

Runs the blocks to its right on the same row once for every field in a structure, in the order the fields were set. The key variable holds the field name each time round and the value variable holds the field's value, so a body that adds the value to a total walks a whole stats sheet one field at a time. The fields are snapshotted at the start, so a body that adds or removes a field does not change the run. When a field's value is an object handle — the kind Store Object In Structure writes — the body round also points the rest of the chain at that live object, so body actions hit that one object. A structure with more than 1000 fields runs only the first 1000 and warns; a variable that holds no structure warns and nothing runs. The keys-list path walks the names only: List Structure Keys into a list, then For Each Item over the keys, hands the body each field name — but the value for a key held in a variable needs this block, because Get Structure Field takes a fixed field name.

**Fields:**

- **Structure variable** - e.g. stats, the structure the structure blocks build
- **Key variable** - e.g. field, holds the field name each time round
- **Value variable** - e.g. value, holds the field's value each time round
- **Index variable (optional)** - e.g. index, counts 1, 2, 3

#### For Each Tagged Object

Runs the blocks to its right on the same row once for every live object carrying the tag, in live order. Body actions that target the object hit one object at a time — the current one — so the same chain can damage every goblin or move every coin. When the Object variable is named it holds the current object each time round, so Read Object Property can read it even when the tagged objects have different names. The index variable, when named, counts 1, 2, 3. More than 1000 live tagged objects runs only the first 1000 and warns; no live tagged objects runs nothing; a blank tag warns and holds.

**Fields:**

- **Tag** - e.g. goblin
- **Object variable (optional)** - e.g. foe, holds the current object each time round
- **Index variable (optional)** - e.g. index, counts 1, 2, 3

#### Broadcast Event

Sends a named event to every On Event listener with the same name. An event carries no value with it, so set a variable first when the listener needs a number or a name. A blank name warns and does nothing.

**Fields:**

- **Event name** - e.g. goal-scored

#### On Event

True for one frame when the named event is broadcast, so the blocks to its right run once per broadcast. A listener after the broadcaster in the grid fires in the same frame; a listener before it fires on the next frame. Several broadcasts of one name in one frame still fire it once, and a broadcast every frame fires it every frame. A name that is never broadcast stays quiet, so spell it exactly as the Broadcast block does. The event state survives scene switches inside a run.

**Fields:**

- **Event name** - e.g. goal-scored

### Variable Presets (48)

| Block | Type | What it does |
|---|---|---|
| add ammo | Action |  |
| add bossHealth | Action |  |
| add coins | Action |  |
| add doorsOpen | Action |  |
| add energy | Action |  |
| add health | Action |  |
| add keys | Action |  |
| add lives | Action |  |
| add quest | Action |  |
| add score | Action |  |
| add timer | Action |  |
| add wave | Action |  |
| ammo >= value | Condition |  |
| bossHealth >= value | Condition |  |
| coins >= value | Condition |  |
| doorsOpen >= value | Condition |  |
| energy >= value | Condition |  |
| health >= value | Condition |  |
| keys >= value | Condition |  |
| lives >= value | Condition |  |
| quest >= value | Condition |  |
| score >= value | Condition |  |
| set ammo | Action |  |
| set bossHealth | Action |  |
| set coins | Action |  |
| set doorsOpen | Action |  |
| set energy | Action |  |
| set health | Action |  |
| set keys | Action |  |
| set lives | Action |  |
| set quest | Action |  |
| set score | Action |  |
| set timer | Action |  |
| set wave | Action |  |
| subtract ammo | Action |  |
| subtract bossHealth | Action |  |
| subtract coins | Action |  |
| subtract doorsOpen | Action |  |
| subtract energy | Action |  |
| subtract health | Action |  |
| subtract keys | Action |  |
| subtract lives | Action |  |
| subtract quest | Action |  |
| subtract score | Action |  |
| subtract timer | Action |  |
| subtract wave | Action |  |
| timer >= value | Condition |  |
| wave >= value | Condition |  |

#### add ammo

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add bossHealth

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add coins

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add doorsOpen

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add energy

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add health

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add keys

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add lives

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add quest

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add score

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add timer

No description yet.

**Fields:**

- **Value** - e.g. 1

#### add wave

No description yet.

**Fields:**

- **Value** - e.g. 1

#### ammo >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### bossHealth >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### coins >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### doorsOpen >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### energy >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### health >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### keys >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### lives >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### quest >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### score >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### set ammo

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set bossHealth

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set coins

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set doorsOpen

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set energy

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set health

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set keys

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set lives

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set quest

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set score

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set timer

No description yet.

**Fields:**

- **Value** - e.g. 1

#### set wave

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract ammo

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract bossHealth

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract coins

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract doorsOpen

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract energy

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract health

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract keys

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract lives

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract quest

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract score

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract timer

No description yet.

**Fields:**

- **Value** - e.g. 1

#### subtract wave

No description yet.

**Fields:**

- **Value** - e.g. 1

#### timer >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

#### wave >= value

No description yet.

**Fields:**

- **Operator** (options: >=, <=, ==, !=, >, <)
- **Value** - e.g. 1
- **Invert** (options: Off, On)

### Visual Presets (15)

| Block | Type | What it does |
|---|---|---|
| Opacity 0 | Action |  |
| Opacity 0.25 | Action |  |
| Opacity 0.5 | Action |  |
| Opacity 0.75 | Action |  |
| Opacity 1 | Action |  |
| Tint black | Action |  |
| Tint blue | Action |  |
| Tint cyan | Action |  |
| Tint green | Action |  |
| Tint orange | Action |  |
| Tint pink | Action |  |
| Tint purple | Action |  |
| Tint red | Action |  |
| Tint white | Action |  |
| Tint yellow | Action |  |

#### Opacity 0

No description yet.

**Fields:**

- **Object**

#### Opacity 0.25

No description yet.

**Fields:**

- **Object**

#### Opacity 0.5

No description yet.

**Fields:**

- **Object**

#### Opacity 0.75

No description yet.

**Fields:**

- **Object**

#### Opacity 1

No description yet.

**Fields:**

- **Object**

#### Tint black

No description yet.

**Fields:**

- **Object**

#### Tint blue

No description yet.

**Fields:**

- **Object**

#### Tint cyan

No description yet.

**Fields:**

- **Object**

#### Tint green

No description yet.

**Fields:**

- **Object**

#### Tint orange

No description yet.

**Fields:**

- **Object**

#### Tint pink

No description yet.

**Fields:**

- **Object**

#### Tint purple

No description yet.

**Fields:**

- **Object**

#### Tint red

No description yet.

**Fields:**

- **Object**

#### Tint white

No description yet.

**Fields:**

- **Object**

#### Tint yellow

No description yet.

**Fields:**

- **Object**

### World (9)

| Block | Type | What it does |
|---|---|---|
| Clamp To World | Action |  |
| Destroy Outside World | Action |  |
| Enable / Disable Physics | Action |  |
| Set Bounciness | Action |  |
| Set Friction | Action |  |
| Set Gravity | Action |  |
| Set Max Speed | Action |  |
| Set Static / Dynamic | Action |  |
| Wrap At World Edge | Action |  |

#### Clamp To World

No description yet.

**Fields:**

- **Object**
- **Bounce**

#### Destroy Outside World

No description yet.

**Fields:**

- **Object**
- **Margin** - e.g. 40

#### Enable / Disable Physics

No description yet.

**Fields:**

- **Object**
- **Enabled**
- **Reset velocity**

#### Set Bounciness

No description yet.

**Fields:**

- **Object**
- **Bounciness** - e.g. 0.4

#### Set Friction

No description yet.

**Fields:**

- **Object**
- **Friction** - e.g. 0.82

#### Set Gravity

No description yet.

**Fields:**

- **Object**
- **Gravity** - e.g. 0.8

#### Set Max Speed

No description yet.

**Fields:**

- **Object**
- **Max Speed** - e.g. 12

#### Set Static / Dynamic

No description yet.

**Fields:**

- **Object**
- **Static**

#### Wrap At World Edge

No description yet.

**Fields:**

- **Object**
