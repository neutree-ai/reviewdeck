/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-no-upper-layers",
      comment: "core must not import from cli or web",
      severity: "error",
      from: { path: "^src/core" },
      to: { path: "^src/(cli|web)" },
    },
    {
      name: "cli-no-upper-layers",
      comment: "cli must not import from web or service (except main.ts dispatching to serve)",
      severity: "error",
      from: { path: "^src/cli", pathNot: "^src/cli/main\\.ts$" },
      to: { path: "^src/(web|service)" },
    },
    {
      name: "main-only-serve-entry",
      comment: "main.ts may only import the serve entry point from service, nothing else",
      severity: "error",
      from: { path: "^src/cli/main\\.ts$" },
      to: { path: "^src/service", pathNot: "^src/service/serve\\.ts$" },
    },
    {
      name: "service-no-upper-layers",
      comment: "service must not import from cli or web",
      severity: "error",
      from: { path: "^src/service" },
      to: { path: "^src/(cli|web)" },
    },
    {
      name: "web-no-cli",
      comment: "web must not import from cli or service",
      severity: "error",
      from: { path: "^src/web" },
      to: { path: "^src/(cli|service)" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
