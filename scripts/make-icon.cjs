/**
 * Renders build/icon.svg into build/icon.ico (and a 512px PNG for the README).
 *
 * Run with:  npx electron scripts/make-icon.cjs
 *
 * Chromium does the rasterising, so the SVG in the repo stays the single source
 * of truth and the .ico is a build artefact anyone can regenerate.
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const ROOT = join(__dirname, '..');
const ICO_PATH = join(ROOT, 'build', 'icon.ico');
const PNG_PATH = join(ROOT, 'build', 'icon.png');

/** Every size Windows asks for, from the taskbar up to the Store tile. */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/**
 * Below this, the detailed drawing stops working: the console frame eats the
 * sheet and the sprocket holes fall under a pixel and turn to mush. Small sizes
 * get their own simplified drawing rather than a downscale of the big one.
 */
const SMALL_UP_TO = 24;

const variantFor = (size) => (size <= SMALL_UP_TO ? 'small' : 'detailed');

const SVG_PATHS = {
  detailed: join(ROOT, 'build', 'icon.svg'),
  small: join(ROOT, 'build', 'icon-small.svg')
};

/** The window stays this big; only the SVG inside it changes size. */
const CANVAS = 512;

/**
 * One fixed window, loading a real file, with the SVG resized inside it.
 *
 * Two things forced this shape. A data: URL per size fails intermittently
 * under offscreen rendering, with the navigation cancelled and load()
 * rejecting. And Windows refuses to make a window smaller than about 20px, so
 * sizing the *window* per icon size silently produces a 20px capture when 16
 * was asked for. Resizing the SVG inside a fixed canvas and capturing the
 * top-left rect avoids both, and draws every size crisply at its own scale
 * rather than downsampling one big render.
 */
const makeRenderer = async (variants) => {
  const pagePath = join(tmpdir(), `docket-icon-${process.pid}.html`);
  writeFileSync(
    pagePath,
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;padding:0;overflow:hidden;background:#12160f}
       svg{display:none;position:absolute;top:0;left:0}
       svg.on{display:block}
     </style>
     <div id="detailed">${variants.detailed}</div>
     <div id="small">${variants.small}</div>`,
    'utf8'
  );

  const window = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(pagePath);

  const renderAt = async (size, variant = variantFor(size)) => {
    await window.webContents.executeJavaScript(
      `(() => {
         document.querySelectorAll('svg').forEach((node) => node.classList.remove('on'));
         const svg = document.querySelector('#${variant} svg');
         svg.classList.add('on');
         svg.setAttribute('width', '${size}');
         svg.setAttribute('height', '${size}');
         return svg.getBoundingClientRect().width;
       })()`
    );
    // Let the compositor settle on the new geometry before grabbing the buffer.
    await new Promise((resolve) => setTimeout(resolve, 140));

    const image = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: size,
      height: size
    });
    // capturePage takes a rect in device-independent pixels but returns
    // physical ones, so on a scaled display a 16 DIP request comes back at 20.
    // The scale factor is pinned below; this is the belt to that braces.
    const { width, height } = image.getSize();
    const exact =
      width === size && height === size
        ? image
        : image.resize({ width: size, height: size, quality: 'best' });

    const png = exact.toPNG();
    if (png.length === 0) throw new Error(`empty render at ${size}px`);
    return png;
  };

  const dispose = () => {
    if (!window.isDestroyed()) window.destroy();
    rmSync(pagePath, { force: true });
  };

  return { renderAt, dispose };
};

/**
 * Assembles a PNG-compressed .ico. Windows has accepted PNG payloads inside
 * ICO since Vista, which keeps the file small and the alpha channel clean —
 * a BMP payload would need its own AND mask per size.
 */
const buildIco = (entries) => {
  const HEADER = 6;
  const DIRECTORY = 16;

  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  let offset = HEADER + DIRECTORY * entries.length;
  const directory = [];

  for (const entry of entries) {
    const record = Buffer.alloc(DIRECTORY);
    // 0 means 256 in the ICO directory — the field is a single byte.
    record.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0);
    record.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1);
    record.writeUInt8(0, 2); // palette size
    record.writeUInt8(0, 3); // reserved
    record.writeUInt16LE(1, 4); // colour planes
    record.writeUInt16LE(32, 6); // bits per pixel
    record.writeUInt32LE(entry.png.length, 8);
    record.writeUInt32LE(offset, 12);
    directory.push(record);
    offset += entry.png.length;
  }

  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.png)]);
};

// Without this the icon is rasterised at the developer's display scale, so the
// same source produces different pixels on a 125% machine than on a 100% one.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const strip = (path) => readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    const variants = { detailed: strip(SVG_PATHS.detailed), small: strip(SVG_PATHS.small) };
    mkdirSync(join(ROOT, 'build'), { recursive: true });

    const { renderAt, dispose } = await makeRenderer(variants);

    const entries = [];
    for (const size of SIZES) {
      entries.push({ size, png: await renderAt(size) });
      process.stdout.write(`  ${size}${variantFor(size) === 'small' ? '·s' : ''}`);
    }
    process.stdout.write('\n');

    writeFileSync(ICO_PATH, buildIco(entries));
    writeFileSync(PNG_PATH, await renderAt(CANVAS, 'detailed'));
    dispose();

    const ico = readFileSync(ICO_PATH);
    console.log(`icon.ico  ${SIZES.join(', ')}  ->  ${(ico.length / 1024).toFixed(1)} KB`);
    console.log(`icon.png  512px`);
    app.exit(0);
  } catch (error) {
    console.error('icon build failed:', error);
    app.exit(1);
  }
});
