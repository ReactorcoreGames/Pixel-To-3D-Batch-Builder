<h1 id="pixel-to-3d-batch-builder">Pixel to 3D Batch Builder</h1>
<p><strong>This is a windows program that lets you convert your individual pixel art images into:</strong></p>
<ul><li><strong>3D low poly models (.GLB)</strong></li><li><strong>Normal maps &amp; roughness maps for said low poly models</strong><strong><br></strong></li><li><strong>Voxel models (.VOX)</strong><strong><br></strong></li><li><strong>Spritesheets <br></strong></li><li><strong>(Doom&nbsp;II, Diablo 2, Advance Wars, RPG Maker, UI Icons, Red Alert 2)</strong><strong><br></strong></li><li><strong>Turntable animated spinning .GIF</strong><strong><br></strong></li><li><strong>and more.</strong><strong><br></strong></li></ul>
<p>Designed for layperson pixel artists -&nbsp;this is as easy as it gets.&nbsp;</p>
<p>It will save you hours, days, weeks or even months of otherwise tedious work.</p>
<h3>Start with your original pixel art sprites:</h3>
<p><strong><img src="https://img.itch.zone/aW1nLzMwNTExMjg0LnBuZw==/original/Zy%2F3Ky.png"></strong></p>
<p><strong>Then make them into Voxel models OR Low Poly models with only a few clicks:&nbsp;</strong></p>
<p><img src="https://img.itch.zone/aW1nLzMwNTExMzQ2LnBuZw==/original/AE%2BIc5.png"><br></p>
<p><img src="https://img.itch.zone/aW1nLzMwNTExMzgzLnBuZw==/original/XK%2FFmy.png"><br></p>
<p><strong>The above was done in mere minutes.</strong></p>
<p>I could later even edit the 6-sided sheets by hand if I wanted to further refine the shapes of the models, but <strong>what you see above was created without any&nbsp;editing on my part.</strong></p>
<p><strong>All I did was choose:</strong></p>
<ol><li><strong>What side</strong> is my sprite showing (Front, side, top, etc.)</li><li><strong>How deep/thick</strong> it is in pixels</li><li><strong>What general shape</strong> is it supposed to conform to (Box, tube, diamond, ball, etc.)</li></ol>
<p>The algorithm is able to take just those three pieces of information and figure out the entire model as seen above.</p>
<p>And later, you can even configure more settings, like:&nbsp;</p>
<ul><li>How its filled (voxel interiors)</li><li>How many sides to make a low poly smoother/rounder</li><li>How shiny or rough it is</li><li>How its rendered, what filter to use, what camera type</li></ul>
<p><strong>All of this works locally on your computer, with unlimited usage, lightning fast speed and instant previews.</strong></p>
<p>There are useful tooltips, easy layperson-friendly labels everywhere and included guides &amp; bonus materials that will help you learn and use this easily - within minutes.</p>
<h2>Importing sprites</h2>
<p>The imported pixel-art sprites <strong>must be individual object&nbsp;PNG images</strong> with a <strong>maximum size of 128x128px</strong> - its the biggest sensible size a voxel model can be.</p>
<p><strong>The background of those sprites must be fully transparent -&nbsp;</strong>it's what the program's algorithm relies on when it traces to sprites to figure out the model.</p>
<p>If you need tools to slice up a spritesheet of many objects into individual sprites, I can recommend these:</p>
<blockquote><strong>Sprite Extractor by NoEyeFish<br></strong><a href="https://noeyefish.github.io/extract/">https://noeyefish.github.io/extract/</a>&nbsp;</blockquote>
<blockquote><strong>Alferd Spritesheet Unpacker by&nbsp;ForkandBeard<br></strong><a href="https://forkandbeard.itch.io/asu">https://forkandbeard.itch.io/asu</a></blockquote>
<h2>Export details</h2>
<ul>
<li>🔺 <strong>Low-poly .GLB models</strong> with crisp pixel textures - emulating a&nbsp;SNES / N64 / PS1 style.&nbsp;Ready for Godot, Unity, Blender and most engines</li>
<li>🧊 <strong>MagicaVoxel .VOX models</strong>, with insides you choose: tree rings, layer cake, flesh &amp; bone, machinery, hollow shells&hellip;</li>
<li>🎞 <strong>Rendered sprite sheets .PNG</strong>&nbsp; from any angle:&nbsp;<br>+ Head-on<br><img src="https://img.itch.zone/aW1nLzMwNjE0MTY4LnBuZw==/original/Af9c9v.png"><br>+ Doom-style rotations<br><img src="https://img.itch.zone/aW1nLzMwNjE0MTYwLnBuZw==/original/6mVMIN.png"><br>+ RPG Maker MV/MZ character sheets<br><img src="https://img.itch.zone/aW1nLzMwNjE0MTcyLnBuZw==/original/zxwqiB.png"><br>+ Diablo-style isometric<br><img src="https://img.itch.zone/aW1nLzMwNjE0MTc0LnBuZw==/original/0Y1nu7.png"><br>+ Rollercoaster Tycoon 2 isometric<br><img src="https://img.itch.zone/aW1nLzMwNjE0MTgwLnBuZw==/original/ygz8vj.png"><br>+ Red Alert 2 style classic RTS unit sprites<br><img src="https://img.itch.zone/aW1nLzMwNjE0MTg3LnBuZw==/original/qdcjD8.png"><br>+ Advance Wars style battle-animation sprites (either using a perspective or hand-drawn-style oblique camera type)<br><img src="https://img.itch.zone/aW1nLzMwNjE0MjEwLnBuZw==/original/42Eowk.png"><br>+ Typical UI inventory icons<br><br>...or you can make own presets freely!</li>
<li>🌀 <strong>Turntable .GIF</strong>, side pictures, sprite-stacking strips and colour palettes</li>
<li>✨ <strong>Plus optional modern touches:</strong> normal maps in six styles, crevice shadows, shiny trims (Low poly models)</li></ul>
<p><img src="https://img.itch.zone/aW1nLzMwNTExNDQwLnBuZw==/original/xDf17X.png"></p>
<h2 id="how-it-works">How it works</h2>
<ol>
<li><strong>Sprites → Sheets.</strong> Every sprite becomes a six-sided sheet, worked out from your drawing and the shape you picked (box, tube, ball, gem, diamond&hellip;).</li>
<li><strong>Paint (optional).</strong> Fix anything the program couldn't guess in your own art program. It reloads the sheet the moment you save.</li>
<li><strong>Sheets → Models.</strong> Tick the exports you want, press one button, and the whole batch is built.</li>
</ol>
<h2 id="made-for">Made for laypersons</h2>
<ul>
<li>Retro 3D and N64/PSX-style games, boomer shooters, voxel games</li>
<li>Pixel artists who want turntables and multi-angle sprites&nbsp;</li><li>People who hate&nbsp;learning/using Blender or other 3D modelling software</li>
<li>Doom modders, RPG Maker authors, Diablo 2 modders, Advance Wars...</li><li>GZDoom/UZDoom gamedevs (for props/objects&nbsp;+ palette)</li>
<li>Game jams: props/assets for a whole game in minutes</li><li>Busy people that want lots of content/assets really fast and easily <br><em>(assuming you can provide/draw the pixel-art sprites</em><em>&nbsp;first)</em></li>
</ul>
<h2 id="also-included">Also included bonus!</h2>
<ul>
<li>A ready-made <strong>Godot 4 preview project</strong> to see your models under real game lighting</li>
<li>A <strong>command-line tool</strong> so AI coding helpers like Claude can turn sprites into models inside your project</li>
<li>An <strong>example batch of 71 sprites</strong> (CC0) to try everything right away</li>
<li>A friendly picture guide for every step - any layperson will be a pro in minutes!</li>
</ul>
<p><strong>Windows 10/11, portable</strong> (unzip and run, nothing to install).&nbsp;</p>
<p>---</p>
<p>This program is unlimited, offline, standalone, portable (put it in a USB!), does not use any AI models, everything works purely via&nbsp;smart magical algorithms to build models from just your initial sprite image.</p>
<p>Using the program alongside your favorite image editor to tweak the results by hand is always supported, but often the program does such an insanely&nbsp;good job that the models are usable right away.</p>
<p>---</p>
<p>Made by Reactorcore · <a href="https://linktr.ee/reactorcore">https://linktr.ee/reactorcore</a></p>