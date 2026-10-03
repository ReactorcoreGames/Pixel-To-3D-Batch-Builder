# Pixel to 3D Batch Builder: promo kit

## Strategy

### Who it's for

- **Indie and hobby game developers with 2D art who want 3D (or 2.5D) versions**: retro 3D games, PS1-style horror, boomer shooters, voxel games, top-down games with 3D props. The pitch is "you already drew it once, get the 3D version without modelling it again".
- **Pixel artists** who want turntables, isometric sprite sets and Doom/RPG Maker sprites of their work without learning Blender.
- **Modders** (Doom mods, RPG Maker, voxel games) who need sprites from many angles, in the games' own formats.
- **Game jam teams**: placeholder and prop models for a whole batch in minutes.
- **People using AI coding helpers** (Claude Code and similar): the command-line tool lets their helper turn a folder of sprites into models inside their own project. This is a small but fast-growing, very reachable audience.

### What to show

People decide in two seconds from a picture or a 5-second clip. The strongest proofs are **before → after pairs**: a flat sprite next to its spinning model. Lead with:

1. A turntable GIF grid: 6–12 sprites and their spinning models (the program makes the GIFs itself; use the example session).
2. The cover image (`promo/cover_1280x720.png`), the one-sprite infographic (`promo/one_sprite_infographic_2560x1440.png`: the wooden barrel and every export it gets, the "aha" picture for an itch gallery, a Reddit post or a video thumbnail) and the three showcase sheets (`promo/showcase_*.png`).
3. A short screen recording: drop a folder of sprites → Make sheets → Export → open the GLB in Godot. Under a minute, no talking needed, captions only.

### Where to post, in order of long-term value

1. **itch.io** (the home page). Category *Tools*, with the tags below. itch is where people browse for exactly this, and pages keep getting found for years. Add a devlog post with each update, since devlogs push the page back into feeds.
2. **GitHub** (if you publish the source). Good topics bring steady search traffic from developers; link it from itch and the readme.
3. **YouTube**: one showcase video (see below). Videos about "turn 2D sprites into 3D" get found through search for a long time.
4. **Reddit**: a few targeted posts (below). Short-lived, but a good post brings a burst of itch visitors and wishlists of your other projects.
5. **Social posts** (Bluesky, X, Mastodon) with a GIF and the hashtags `#pixelart #gamedev #indiedev #voxel #lowpoly #psx #madewithgodot #indiedevhour`, plus `#screenshotsaturday` on Saturdays.
6. **Discord**: your own server first; then showcase channels of the Godot, MagicaVoxel and pixel-art communities you're already in (read each server's rules on self-promotion).

### Tactics

- **Always post the GIF, not a link.** Link in the first comment or the end of the post where rules allow it.
- **Answer every comment in the first hours**; it decides how far a post spreads.
- **Ask for sprites**: "send me a sprite and I'll post its 3D version" brings replies, and every reply is a new before/after to share.
- **Update cadence**: each new feature (a new sprite set preset, a new shape) is a new devlog, a new GIF and a new reason to post.
- **Cross-link your catalog**: every page ends with your linktree, so a visitor to this tool can find your other projects.

### Business model: honest estimate

**Paid on itch.io, with the source code public on GitHub** (your usual model), is a good fit here. The price stays out of the docs so it can move with the situation.

- **Why paid works for this one:** it saves real hours of 3D work per asset, and the people who need it most (indie devs shipping retro 3D games, modders, pixel artists selling asset packs) are used to paying a few dollars for tools that save them time. A low price is an easy yes next to learning Blender.
- **Why the public source doesn't hurt sales:** almost nobody who would buy a ready-to-run exe will set up Node, Rust and a Tauri build to compile it themselves. The GitHub page works as a second front door instead: developers find it through search and topics, it shows the tool is real and safe, and AI-helper users can read how the command-line tool works. Link the itch page prominently at the top of the GitHub readme, so the build-it-yourself crowd still sees where the finished program lives.
- **Price as you go:** starting low and raising it once the page has ratings and comments rewards early buyers without having to run an official "early access" campaign. itch's sales and bundles are a cheap way to get a burst of attention later.
- **Extra income later:** asset packs of models made with the tool from your own sprites (sold on itch) are a natural add-on, and every pack page advertises the tool.

## Copy-paste: itch.io

**Name of project**

Pixel to 3D Batch Builder

**Subtitle (under 100 characters)**

Batch-turn pixel-art sprites into low-poly GLB models, MagicaVoxel models and sprite sheets

**Long description (markdown)**

```markdown
# Pixel to 3D Batch Builder

**You already drew it once. Now get the 3D version in one click.**

Drop in a folder of pixel-art sprites (up to 128 × 128), tell the program how thick each one is and roughly what shape it has, and get back a whole batch of 3D models in the SNES / N64 / PS1 style:

- 🔺 **Low-poly GLB models** with crisp pixel textures, ready for Godot, Unity, Blender and most engines
- 🧊 **MagicaVoxel .vox models**, with insides you choose: tree rings, layer cake, flesh & bone, machinery, hollow shells…
- 🎞 **Rendered sprite sheets** from any angle: isometric, head-on, Doom-style rotations (in Doom's own file format), RPG Maker MV/MZ character sheets, Diablo-style, classic RTS, inventory icons, big battle-scene pictures (perspective or hand-drawn-style oblique), or your own presets
- 🌀 **Turntable GIFs**, side pictures, sprite-stacking strips and colour palettes
- ✨ Optional modern touches: normal maps in six styles, crevice shadows, shiny trims

## How it works

1. **Sprites → Sheets.** Every sprite becomes a six-sided sheet, worked out from your drawing and the shape you picked (box, tube, ball, gem, diamond…).
2. **Paint (optional).** Fix anything the program couldn't guess in your own art program. It reloads the sheet the moment you save.
3. **Sheets → Models.** Tick the exports you want, press one button, and the whole batch is built.

## Made for

- Retro 3D and PSX-style games, boomer shooters, voxel games
- Pixel artists who want turntables and multi-angle sprites without learning Blender
- Doom and RPG Maker modders
- Game jams: props for a whole level in minutes

## Also included

- A ready-made **Godot 4 preview project** to see your models under real game lighting
- A **command-line tool** so AI coding helpers like Claude can turn sprites into models inside your project
- An **example batch of 71 sprites** (CC0) to try everything right away
- A friendly picture guide for every step

**Windows 10/11, portable** (unzip and run, nothing to install). The models are rough drafts by design: a fast starting point, or good enough as they are for retro games.

Made by Reactorcore · https://linktr.ee/reactorcore
```

**10 tags**

pixel-art, 3d, voxel, low-poly, sprites, game-development, magicavoxel, psx, tool, asset-creation

## Copy-paste: GitHub

**Description blurb**

Batch tool that turns pixel-art sprites into low-poly GLB models, MagicaVoxel .vox models and rendered sprite sheets (SNES / N64 / PS1 look). Desktop app (Tauri) plus a command-line tool.

**10 topics**

pixel-art
voxel
low-poly
gltf
magicavoxel
sprite-sheet
gamedev-tools
psx
tauri
typescript

## Copy-paste: YouTube

**Title**

Turn Pixel Art Sprites into 3D Models (a whole folder at once) | Pixel to 3D Batch Builder

**Description**

```
Pixel to 3D Batch Builder turns flat pixel-art sprites into low-poly 3D models, MagicaVoxel voxel models and rendered sprite sheets, a whole batch at a time. Get it for Windows:
[itch.io link]

In this video:
0:00 Sprites in, models out
0:15 Step 1: sprites become six-sided sheets
0:35 Painting a sheet (optional)
0:50 Step 2: exporting GLB, VOX, sprite sheets and turntables
1:10 The models in Godot

What it makes:
- Low-poly GLB models with crisp pixel textures (Godot, Unity, Blender…)
- MagicaVoxel .vox models with custom insides
- Isometric, Doom-style, RPG Maker, RTS and custom sprite sets
- Turntable GIFs, side pictures, sprite stacks, palettes
- Optional normal maps, crevice shadows and shiny trims

Made by Reactorcore

Contact: reactorcoregames@gmail.com

Check out everything else I do:
Home/Links: https://linktr.ee/reactorcore
Releases: https://reactorcore.itch.io
Blog: https://www.patreon.com/ReactorcoreGames
Discord: https://discord.gg/UdRavGhj47
Catalog: https://reactorcoregames.github.io/
```

**Tags**

pixel art to 3d, sprite to 3d model, pixel art 3d, voxel, magicavoxel, low poly, psx style, ps1 graphics, gamedev tools, godot, blender alternative, indie game dev, sprite sheet generator, isometric sprites, doom sprites, rpg maker

## Copy-paste: Reddit

These subreddits are suggestions that couldn't be checked from here (Reddit blocks bots), so read each one's sidebar and rules before posting. Paid tools are held to stricter self-promotion rules than free ones on most subreddits, so lead with the GIF and the how-it-works story, say openly that you made it, and put the link where the rules allow it. Post the GIF or video as the main content wherever the subreddit allows media.

**1. r/gamedev** (usually wants text posts with something to learn; self-promotion often only in its weekly threads)

Title: I made a tool that turns a folder of pixel-art sprites into low-poly and voxel 3D models. Here's how it guesses the missing sides

Post:
```
I had a pile of 2D props and wanted 3D versions for a PS1-style project, so I built a batch tool for it. The interesting part was the "guessing": a sprite only shows one side, so each sprite first becomes a six-sided contact sheet (front/back/left/right/top/bottom), worked out from the drawing plus a shape you pick (box, tube, ball, gem…). You can paint fixes on that sheet in any art program, and the model is the intersection of what all six sides allow, with split planes so the front half and back half can have different outlines (that's how mugs get blind holes).

Then it builds low-poly GLB models (traced outlines, pixel-aware slope straightening, manifold for the booleans), MagicaVoxel files, and rendered sprite sets (isometric, Doom rotations, RPG Maker sheets) with a small software rasterizer.

Happy to go into any part of it. The tool is on itch.io and the source is on GitHub: [links in comments / at the end, if the rules allow]
```

**2. r/godot** (showcase-friendly; mention the Godot preview project)

Title: Batch-convert pixel-art sprites into GLB models with crisp textures (comes with a Godot preview project)

Post: the GIF of models spinning in the Godot preview, plus:
```
Drop in sprites, pick thickness and shape, get low-poly GLB models with nearest-filtered pixel textures, optional normal/AO/roughness maps. It ships with a small Godot 4 project that loads a whole folder of the GLBs at runtime so you can flip through them under real lighting. Windows, source on GitHub: [link]
```

**3. r/PixelArt** (strict about self-promotion; usually best as an art post with a flair like "Tool" or "OC", and the tool mentioned in a comment)

Title: My pixel-art props, turned into 3D turntables

Post: a grid GIF of 9–12 sprites and their spinning models. First comment: "Made with a tool I wrote for this: [link]. Happy to run anyone's sprite through it."

**4. r/IndieDev** (relaxed about self-promotion)

Title: I got tired of remaking my 2D props in 3D, so I made a tool that does a whole folder at once

Link: the YouTube video or the itch.io page.

**5. r/MagicaVoxel** or **r/VoxelGameDev**

Title: Turning pixel-art sprites into .vox models in bulk, with custom insides (tree rings, flesh & bone, machinery)

Post: a GIF of a model peeled open in the voxel view, plus the itch link.

## Other places (up to 3)

1. **AlternativeTo.net**: add it as an alternative to other sprite-to-3D and voxelizer tools (it's open source, which AlternativeTo lets people filter by); people search there for exactly this, and listings stay up for years.
2. **OpenGameArt.org forums** (Tools section) and **Lospec** communities: pixel-art crowds who share tools and workflows.
3. **Godot Forum** (Showcase) and the **itch.io community forum** ("Release Announcements"): long-lived threads that show up in search.

## Help spread the word 🙌

Hey you, the reader that isn't Reactorcore themself!

If this tool saved you some time, the best thanks is telling someone who'd like it: share the itch.io page, post your before → after GIFs (mention where they came from), or leave a comment and a rating on itch.

### Marketer needed! - partner up with me

I work knee-deep in projects so I rarely have the time to promote/market my projects.

If you want to earn money and are willing to put in the work, you can help reach way more people than I could by going out there and doing cold emails, posting on forums with links and images, contacting youtubers/influencers/communities and getting them to try/buy my projects. 

For every sale I make with proof that it came through your effort (a link, a screenshot, with timestamp) sent to me via reactorcoregames@gmail.com, then I can monitor itch.io traffic and credit you with the sales and pay you out once a month 50% of what we earned (after platform cuts, so a $10 product is split $2 to itch.io, $4 to me and $4 to you - paid to you via paypal via Goods and Services transactions). 

Contact me for more information if you're interested.

---

Made by Reactorcore · https://linktr.ee/reactorcore
