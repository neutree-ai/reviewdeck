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
      comment: "cli must not import from web",
      severity: "error",
      from: { path: "^src/cli" },
      to: { path: "^src/web" },
    },
    {
      name: "web-no-cli",
      comment: "web must not import from cli",
      severity: "error",
      from: { path: "^src/web" },
      to: { path: "^src/cli" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
