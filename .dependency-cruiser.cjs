/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-no-upper-layers",
      comment: "core must not import from cli, server, or web",
      severity: "error",
      from: { path: "^src/core" },
      to: { path: "(^src/web|^packages/)" },
    },
    {
      name: "cli-no-web",
      comment: "cli must not import from web",
      severity: "error",
      from: { path: "^packages/reviewdeck/src" },
      to: { path: "^src/web" },
    },
    {
      name: "web-no-upper-layers",
      comment: "web must not import from cli or server",
      severity: "error",
      from: { path: "^src/web" },
      to: { path: "^packages/" },
    },
    {
      name: "server-no-web",
      comment: "server must not import from web",
      severity: "error",
      from: { path: "^packages/reviewdeck-server/src" },
      to: { path: "^src/web" },
    },
    {
      name: "cli-no-server",
      comment: "cli must not import from server",
      severity: "error",
      from: { path: "^packages/reviewdeck/src" },
      to: { path: "^packages/reviewdeck-server" },
    },
    {
      name: "server-no-cli",
      comment: "server must not import from cli",
      severity: "error",
      from: { path: "^packages/reviewdeck-server/src" },
      to: { path: "^packages/reviewdeck/" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
