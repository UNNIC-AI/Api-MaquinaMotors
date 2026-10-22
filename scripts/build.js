// Genera dist/: el panel listo para entregar al cliente, sin el código fuente.
//
//   dist/
//     src/server.js      servidor empaquetado en un solo fichero y minificado
//     src/swagger.json   documentación de la API (los comentarios no sobreviven al minificado)
//     public/            panel web con el JS y el CSS minificados
//     package.json, package-lock.json, Dockerfile, .dockerignore
//
// Las dependencias (express, pg…) no se empaquetan: las instala Docker con npm ci.
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const pkg = require(path.join(root, "package.json"));

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "src"), { recursive: true });
fs.mkdirSync(path.join(dist, "public"), { recursive: true });

// 1. Servidor: src/server.js + app.js + db.js en un fichero, sin comentarios ni nombres legibles.
esbuild.buildSync({
  entryPoints: [path.join(root, "src/server.js")],
  outfile: path.join(dist, "src/server.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minify: true,
  legalComments: "none",
  packages: "external",
});

// 2. Documentación de la API, generada ahora a partir de los comentarios @openapi.
//    Hacen falta variables de relleno para poder cargar app.js; no se conecta a nada.
Object.assign(process.env, { DATABASE_URL: "postgres://build@localhost/build", API_ACCESS_KEY: "build", ENCRYPTION_KEY: "build" });
const { swaggerSpec } = require(path.join(root, "src/app.js")).locals;
fs.writeFileSync(path.join(dist, "src/swagger.json"), JSON.stringify(swaggerSpec));

// 3. Panel web: JS y CSS minificados, HTML tal cual.
for (const [file, loader] of [["app.js", "js"], ["styles.css", "css"]]) {
  const { code } = esbuild.transformSync(fs.readFileSync(path.join(root, "public", file), "utf8"), {
    loader,
    minify: true,
    legalComments: "none",
    target: loader === "js" ? "es2020" : undefined,
  });
  fs.writeFileSync(path.join(dist, "public", file), code);
}
fs.copyFileSync(path.join(root, "public/index.html"), path.join(dist, "public/index.html"));

// 4. Lo que necesita Docker para instalar y arrancar. Se mantienen las
//    devDependencies para que package.json y package-lock.json cuadren (npm ci
//    lo exige); con --omit=dev no se instalan.
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  description: pkg.description,
  main: "src/server.js",
  scripts: { start: "node src/server.js" },
  engines: pkg.engines,
  dependencies: pkg.dependencies,
  devDependencies: pkg.devDependencies,
};
fs.writeFileSync(path.join(dist, "package.json"), JSON.stringify(distPkg, null, 2) + "\n");
fs.copyFileSync(path.join(root, "package-lock.json"), path.join(dist, "package-lock.json"));
fs.copyFileSync(path.join(root, "Dockerfile"), path.join(dist, "Dockerfile"));
fs.writeFileSync(path.join(dist, ".dockerignore"), "node_modules\n.env\n");

console.log(`dist/ generado (v${pkg.version})`);
