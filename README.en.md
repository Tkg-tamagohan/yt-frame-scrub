# yt-frame-scrub

[日本語版 README はこちら](README.md)

A Chrome extension that steps paused YouTube videos forward and backward one frame at a time with the mouse wheel.
Shows the frame number and timecode in an overlay.

## Supported pages

- YouTube watch pages and YouTube Shorts
- Automatically disabled during ads and live streams

## Installation

Load the extension in developer mode:

1. Clone this repository and build it.

   ```bash
   npm install
   npm run build
   ```

2. Open `chrome://extensions` in Chrome and enable "Developer mode".
3. Click "Load unpacked" and select the `dist/` folder.

You can also extract the zip from a GitHub Release and load it the same way.
The zip is generated with `npm run pack` (see below).

## Usage

- Pause a YouTube video and scroll the wheel over the player to step one frame per notch (scroll up steps forward, scroll down steps back, by default).
- Hold Shift while scrolling to move multiple frames per notch (10 by default).
- Click the toolbar action icon to toggle the feature on and off.
- Scroll direction inversion, a required modifier key for scroll capture, the accumulation threshold, overlay visibility, and manual fps can be configured on the extension's options page (`chrome://extensions` → Details → Extension options). Settings are synced across browsers.

## Development

- `npm run build`: generates a loadable extension in `dist/`
- `npm run test`: unit tests with vitest
- `npm run typecheck`: type checking
- `npm run pack`: zips `dist/` into `yt-frame-scrub-<version>.zip` (for GitHub Releases)

TypeScript + esbuild + vitest. Manifest V3 compliant.

## Documentation

Documentation is written in Japanese:

- [Requirements definition](docs/requirements-definition.md)
- [Decision records](docs/decision-records.md)
- [Implementation plan](docs/implementation-plan.md)
- [Manual test procedures](docs/manual-test.md)
- [Chrome Web Store listing](docs/store-listing.md)

## License

MIT License.
See `LICENSE`.
