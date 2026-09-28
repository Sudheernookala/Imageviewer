# Image Viewer — Angular UI

Angular 21 app that uses the shared `<image-viewer>` component from `../public/viewer/`.
It is a static site (no server), so it can be hosted on GitLab Pages.

![Angular UI](../docs/angular-screenshot.png)

## What it does

- Opens with the sample images, so there is always something to see.
- **Open folder:** pick a folder on your computer; all images inside it (including subfolders) are listed.
- **Open files:** pick one or more image files (also works on phones).
- **Web address:** paste an image URL.
- Filter the list, use ↑/↓ to move through images.
- Files are read inside the browser. Nothing is uploaded.

Why no "type a path" box like the Node app? Browsers do not let a website read `C:\Photos` or `/home/me/Pictures` by path. The user has to pick the folder. That is a browser security rule, not a missing feature.

## Run locally

Needs Node.js 20.19+, 22.12+ or 24+.

```bash
cd angular
npm install
npm start        # http://localhost:4200
npm run build    # output: dist/image-viewer-ui/browser
```

`npm start` / `npm run build` first run `scripts/copy-shared.mjs`, which copies `../samples` and the TIFF decoder (`../public/viewer/vendor`) into `public/`, and writes the sample list `public/samples/samples.json`.

To change the images people see when they open the site, add or remove files in the repo's `samples/` folder. No code change needed. They are public on the deployed site.

## Use the viewer in your own Angular app

Copy `src/app/image-viewer/image-viewer.component.ts` and the `public/viewer/` folder (fix the import path), make the `vendor/` files available as assets, and set `ImageViewer.vendorBase` to where they are served. Then:

```html
<app-image-viewer [source]="fileOrUrl" [filename]="name"
                  (loaded)="onLoaded($event)" (failed)="onError($event)" />
```

`source` accepts a URL string, a `File`/`Blob`, or `null`. For zoom/rotate from code, get the component with `viewChild` and use `.viewer.zoomIn()`, `.viewer.rotate(90)`, etc.

## Folder picking by browser

| Browser | "Open folder" |
|---|---|
| Chrome, Edge, Opera (desktop) | Native folder picker. Reads files only when you click them. |
| Any browser, when the app is embedded in another page (iframe) | Falls back to the folder upload dialog below. |
| Firefox, Safari (desktop) | Folder upload dialog. The browser reads the file list up front; still nothing leaves your computer. |
| Phones / tablets | Folder picking is not supported by mobile browsers. Use **Open files**. |

Large folders: the list stops at 20,000 images and shows the first 1,000 rows (use the filter to find the rest).
