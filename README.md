# Transport Manager Application

Customer, trip and billing management app for Transport Manager — built with React and a
self-hosted Node.js server (no cloud storage bills). Admin runs the server on one PC; drivers
and the admin connect to it from their phones (via LAN or a Cloudflare Tunnel for access from
anywhere) using the mobile app built with Capacitor.

## Project Structure

- `src/` - React frontend (shared by web, Android and iOS builds)
- `backend/` - Self-hosted Node.js server (zero external dependencies) + JSON file database
  (`backend/data/db.json`)
- `android/`, `ios/` - Capacitor native app projects
- `public/` - Static assets
- `dist/` - Build output (served by the backend in production)

## How it works

- The **admin** runs `npm run start` on an office PC/laptop. This is "the server" — all data
  (customers, trips, bills) lives in `backend/data/db.json` on that machine. No cloud storage
  costs.
- When the admin signs up, a **group code** is generated. Drivers enter that code (or scan the
  admin's join QR code) to link their account to the admin's business.
- Drivers submit trip details (pickup/drop, material, amount, advance, etc.) from their phone.
  These land in the admin's "Pending Approvals" queue in real time and become official once
  approved.
- Bills are generated instantly from a customer's trips, with the business's own logo/colors/
  bank details (editable by the admin under Settings → Bill Branding).
- For drivers away from the office WiFi, run a Cloudflare Tunnel alongside the server so the
  same PC is reachable over the internet — see `CLOUDFLARE_TUNNEL.md`.

## Development

### Prerequisites

- Node.js (v18 or later)

### Setup

```
npm install
cp .env.example .env   # then fill in Gmail app password etc.
```

### Running

```
npm run dev       # Vite dev server (frontend only, hot reload)
npm run server    # Backend API + serves the built frontend
npm run start     # Build frontend, then start the backend (what the admin runs day-to-day)
```

### Building the mobile apps

```
npm run mobile:sync   # builds the frontend and syncs into android/ and ios/
```

Then open `android/` in Android Studio or `ios/` in Xcode to build/run on a device or emulator.

### Backups

Use the Backup/Restore option in the app menu to download/upload a JSON snapshot of all
customers and trips at any time. Since everything lives in one file
(`backend/data/db.json`), you can also just copy that file to back it up manually.
