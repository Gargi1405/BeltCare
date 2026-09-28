# BeltCare

BeltCare is a Vite and Express monitoring dashboard for conveyor-belt joint integrity.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Deploy to Vercel

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Vercel, choose **Add New Project** and import the repository.
3. Keep the detected framework as Vite. The repository includes `vercel.json` with the build and API routing settings.
4. Deploy. The frontend is built from `npm run build`, and Express runs through the catch-all function in `api/[...path].js`.

The current SQL.js database is suitable for a demo or pilot deployment. Vercel Functions do not provide durable local disk storage, so alert acknowledgements, work orders, and feedback can reset when a new function instance starts. For production, move the tables to a hosted database such as Vercel Postgres, Neon, Supabase, or Turso before relying on persistent operator state.

## Replace the logo

Replace `public/logo.svg` with your own SVG using the same filename, or add a PNG and update the `src` in `src/App.jsx`. The dashboard loads the logo from `/logo.svg`.

## Scripts

```bash
npm run dev
npm run build
npm run server
```

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
