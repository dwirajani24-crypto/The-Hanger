# The Hanger

**The Hanger** is a private, install-on-your-phone outfit decider and weekly
wardrobe planner. You photograph the clothes you own, and the app lets you
swipe through them to build outfits, save your favourite combinations, and
plan what you're wearing for the week ahead.

Everything — your photos included — is stored locally in your browser using
a technology called IndexedDB. There's no account, no sign-up, and nothing
is ever uploaded anywhere. You own your data completely.

## What it does

- **Outfit Builder** — swipe through your Tops, Bottoms and Shoes, one rail
  at a time, and combine them into an outfit. Randomise or hit "Surprise me"
  for a fun, random combination.
- **My Wardrobe** — photograph and catalogue every item you own: name,
  category, colour, style and notes. Search and filter by category.
- **Saved Outfits** — every outfit you save lives here, ready to reload,
  edit, or assign to a day.
- **Week Planner** — assign a saved outfit to each day of the week, or tap
  "Random Week" to generate a full week of outfits in one tap.
- **Settings** — export a full backup of your wardrobe as a JSON file,
  import it back in, or clear everything and start fresh.

Because there's no account or server, your wardrobe stays **on the device
you added it on**. If you want the same wardrobe on your iPhone, iPad and
Mac, add your clothes on one device, then use **Export** and **Import** (in
Settings) to copy your data across — see below.

---

## 1. Upload the files to GitHub

1. Go to [github.com](https://github.com) and sign in (create a free
   account first if you don't have one).
2. Click the **+** icon in the top-right corner and choose **New
   repository**.
3. Name it anything you like, for example `the-hanger`. Leave it **Public**.
   Do not tick "Add a README file" — you already have one. Click **Create
   repository**.
4. On the next page, click the link that says **"uploading an existing
   file"**.
5. Drag in every file from this project:
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - `styles.css`
   - `app.js`
   - `icon-192.png`
   - `icon-512.png`
   - `apple-touch-icon.png`
   - `README.md`
6. Scroll down and click **Commit changes**.

All the files must sit in the **root** of the repository (not inside a
folder) — the app expects `styles.css`, `app.js`, etc. to be right next to
`index.html`.

## 2. Enable GitHub Pages

1. In your repository, click **Settings** (top menu bar of the repo).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a
   branch**.
4. Under **Branch**, choose **main** (or `master`) and folder **/ (root)**,
   then click **Save**.
5. Wait a minute or two, then refresh the page. GitHub will show a green
   box with your site's web address, something like:
   `https://your-username.github.io/the-hanger/`

That address is your live app. Open it in a browser to check it loads.

## 3. Open it on your iPhone and install it

1. On your iPhone, open **Safari** (it must be Safari — other browsers
   can't add apps to the Home Screen on iOS).
2. Go to your GitHub Pages address from Step 2.
3. Tap the **Share** icon (the square with an arrow pointing up), at the
   bottom of the screen.
4. Scroll down and tap **Add to Home Screen**.
5. Confirm the name (it should say "The Hanger") and tap **Add**.

The Hanger will now appear on your Home Screen as its own app icon, and
opens full-screen without any Safari address bar.

## 4. Install it on your iPad

The steps are the same as the iPhone:

1. Open **Safari** and go to your GitHub Pages address.
2. Tap the **Share** icon.
3. Tap **Add to Home Screen**, then **Add**.

## 5. Install it on your Mac

1. Open the site in **Safari** on your Mac.
2. In the menu bar, choose **File → Add to Dock** (on recent macOS/Safari
   versions), or open the Share menu in the toolbar and choose **Add to
   Dock**. This installs it as a standalone app window.
3. Alternatively, you can simply bookmark the page — the app works fully
   in a normal browser tab too, it just won't have its own window.

## 6. Using the app

- **Build**: swipe left/right on the Top, Bottom and Shoes photos (or use
  the ‹ › arrows) until you like the combination, then tap **Save Outfit**.
- **Wardrobe**: tap **+ Add Clothing**, take or choose a photo, give it a
  name and category, and tap **Add to Wardrobe**. It's instantly available
  in the Outfit Builder if it's a Top, Bottom or Shoes.
- **Saved**: tap any saved outfit to reload it, assign it to a day, or
  delete it.
- **Week**: tap **Choose Outfit** on any day, or tap **Random Week** to
  fill the whole week at once.
- **Settings**: export a backup regularly. It's a small `.json` file
  containing your whole wardrobe, outfits and week plan (photos included).

### Keeping your wardrobe in sync across devices

The Hanger doesn't use the internet to store data, so a phone and a Mac
won't automatically share the same wardrobe. To copy your data from one
device to another:

1. On the device with your wardrobe, go to **Settings → Export Wardrobe
   Data**. This downloads a `.json` backup file.
2. Get that file onto your other device (AirDrop, iCloud Drive, email to
   yourself — any way you'd normally move a file works).
3. On the other device, open The Hanger, go to **Settings → Import
   Wardrobe Data**, and choose the file. Confirm the warning — this
   **replaces** whatever is already on that device.

### Backups and starting over

- **Export Wardrobe Data** downloads everything as one `.json` file — keep
  this somewhere safe.
- **Import Wardrobe Data** restores from a previously exported file. It
  replaces whatever is currently on that device, so export first if you
  want to keep a copy of the current state.
- **Clear All Data** permanently deletes every item, photo, outfit and
  your week plan from that device. You'll be asked to type `DELETE` to
  confirm, since this cannot be undone.

---

## A note on updates

If you ever come back to edit the code and re-upload it to GitHub, open
`sw.js` and change `CACHE_NAME` (e.g. `the-hanger-shell-v1` →
`the-hanger-shell-v2`). This tells phones that already installed the app
to fetch the new version instead of quietly keeping the old cached one.

## Technical notes (for your own reference)

- No build tools, no npm, no frameworks that need installing — just plain
  HTML, CSS and JavaScript, plus Tailwind CSS loaded from a CDN link.
- Clothing photos are resized and compressed in the browser (via a
  `<canvas>`) before being saved, so your storage doesn't fill up with
  full-resolution camera photos.
- All data is stored in **IndexedDB**, a database built into every modern
  browser, under a database called `TheHangerDB`. The code in `app.js` is
  commented throughout to explain how this works, in case you (or anyone
  helping you later) want to extend the app — for example, to add real
  cloud sync in a future version.
