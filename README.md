# Finance – phone app for the Finance Tracker sheet

A small PWA for logging transactions and seeing your numbers on the phone.
The Google Sheet stays the database; nothing is stored anywhere else.

```
phone (PWA)  --POST JSON + secret key-->  Apps Script web app (Api.gs)  -->  Transactions / Categories tabs
```

## What's in here

| Path | What it is |
|---|---|
| `app/index.html` | The whole app (UI, charts, offline queue, demo mode) |
| `app/sw.js`, `app/manifest.webmanifest`, `app/icons/`, `app/fonts/` | PWA shell: installable, opens instantly, works offline. Fonts are self-hosted |
| `apps-script/Api.gs` | The API, already added to the sheet's script project |
| `apps-script/ConnectPhone.html` | The "Finance > Connect phone app" dialog (QR code), already added |

Code.gs changed in two places: the old `doGet` (it served the sidebar) was removed, because `doGet`/`doPost` now live in Api.gs, and the Finance menu got a "Connect phone app" item.

## Setup (once)

1. **Deploy the API.** Done: deployment "Finance phone app API" (Execute as Me, access Anyone). Its `/exec` URL is already saved in the Connect phone app dialog. To redo it: Deploy > New deployment > Web app.
2. **Host the `app/` folder** on any static HTTPS host:
   - Vercel: `cd finance-pwa/app && npx vercel deploy --prod`
   - or drag the `app` folder into Cloudflare Pages (Direct Upload) or Netlify Drop.
3. **Connect the phone.** In the sheet open **Finance > Connect phone app**, paste the app address from step 2, click **Save and show code**, and scan the QR code with your phone.
4. **Install.** iPhone: Share > Add to Home Screen. Android: the app shows an Install button.
   On iPhone the Home Screen app has its own storage, so if it asks to connect again, open Sync (top right) in Safari, tap **Copy connection link**, and paste it into the installed app.

Want to see it first? Open the hosted app with `?demo=1`, or tap "Try it with sample data".

## Things to know

- **After changing the script, redeploy.** A web app deployment runs a frozen version. After any change to Code.gs or Api.gs: Deploy > Manage deployments > edit (pencil) > Version: **New version** > Deploy. The URL stays the same.
- **Security.** The `/exec` URL is public, but every request needs the 64-character key stored in Script Properties (`FT_API_KEY`). Without it the API only returns an error. "Make a new key" in the dialog disconnects all phones.
- **Same rules as the Dashboard.** Personal income includes Owner payout transfers; business balance is everything kept in the business up to that month. Adds go through the existing `addTransaction()`, so validation, sorting and "Repeat monthly" (Recurring tab) behave exactly like the sidebar. Opening the app also posts due recurring items, like the sidebar does.
- **Offline.** Transactions you add offline wait on the phone ("waiting to sync") and are sent when you're back online. Each one carries an id, so a retry never adds it twice.
- **Updating the app.** Change the files and redeploy the host. Bump `VERSION` in `app/sw.js` so phones pick up the new version on the next launch.
