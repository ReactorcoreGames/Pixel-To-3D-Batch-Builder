# AI image prompts for promo/icon_og.png

The generated image replaces `promo/icon_og.png` as the background art for the itch.io thumbnail (630×500) and cover (1280×720), with the title drawn on top later. The app's actual icon files (`branding/icon.ico` etc.) stay as they are, generated from the 16×16 pixel cube.

Generate at 1024×1024 (square). Ask for no text; the title goes on top afterwards, so leave a calmer area (lower third or one side) where big text can sit.

## Brand colours to mention

- Background: deep midnight grape `#171327`, with plum `#262043`
- Tangerine `#ff9a3c` (step ①), lime `#8fdc4a` (step ②), sunshine yellow `#ffd23f`
- Accents: periwinkle `#7c6cff`, sky blue `#4db8ff`

## Prompt A: hero cube (closest to the logo)

A glowing isometric pixel-art cube floating in the centre, built from chunky visible pixels, with a sunshine yellow top face, tangerine orange left face and lime green right face, crisp 1-pixel dark outline. Around it, small flat 2D pixel-art sprites (a sword, a mug, a goldfish, a potion, a key, a mushroom) fly in from the edges and snap onto the cube, turning into little 3D low-poly and voxel versions of themselves as they get closer. Faint pixel sparkles and square particles. Background is a deep midnight purple (#171327) with a subtle dot grid and soft plum glow behind the cube. Retro SNES / PS1 era game art style mixed with clean modern vector lighting, vibrant but not neon, high detail, centred composition, lower third kept calmer for a title. No text, no letters, no logos.

## Prompt B: flat-to-3D transformation

Split scene showing a transformation from left to right: on the left, flat 2D pixel-art sprites lying on a dark grid like cards (a rifle, a treasure chest, a pine tree, a rocket); in the middle they unfold into six-sided sprite sheets with thin green-and-violet frame lines; on the right they rise up as chunky low-poly 3D models and voxel models with crisp faceted shading. A glowing arrow of tangerine and lime light sweeps through the scene. Deep midnight purple background (#171327), sunshine yellow, tangerine orange and lime green highlights, sky blue rim light. Retro 90s video game box-art energy, pixel-perfect edges, PS1 low-poly charm, isometric camera, rich detail. No text, no letters.

## Prompt C: collection shelf (dense detail)

An isometric diorama shelf crammed with dozens of small colourful low-poly and voxel game props (swords, shields, potions, mushrooms, crates, keys, gems, fish, trees, rockets, mugs), each one sitting next to the flat pixel-art sprite it was made from, like before-and-after pairs. Warm tangerine, lime and sunshine yellow lighting against a deep midnight purple background with a faint dot grid. Chunky pixel-art details, faceted PS1-style shading, playful toy-like feel, extremely detailed, clean readable silhouettes. Leave the top third darker and emptier for a title. No text, no letters.

## Negative prompt (if your generator supports one)

text, letters, words, watermark, signature, logo, UI, blurry, smooth gradients on pixel art, photorealistic, realistic materials, muddy colours, noise, jpeg artefacts, cluttered centre, anti-aliased pixel edges

## Tips

- Midjourney: add `--ar 1:1 --style raw` (and `--stylize 200` for less over-painting).
- If the pixel edges come out soft, add "pixel art, hard edges, no anti-aliasing" near the start of the prompt.
- Prompt A reads best as a thumbnail at small sizes; Prompt C gives the "as much dense visual detail as possible" look the release doc asks for on the cover.
