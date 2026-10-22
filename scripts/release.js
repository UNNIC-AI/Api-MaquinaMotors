// Genera el build (dist/) y lo comprime en release/panel-maquinamotors-<versión>.zip,
// que es lo que se entrega para ponerlo en la carpeta panel/ de maquinamotors_deploy.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const { version } = require(path.join(root, "package.json"));

execFileSync(process.execPath, [path.join(__dirname, "build.js")], { stdio: "inherit" });

const releaseDir = path.join(root, "release");
fs.mkdirSync(releaseDir, { recursive: true });
const zipPath = path.join(releaseDir, `panel-maquinamotors-${version}.zip`);
fs.rmSync(zipPath, { force: true });

// -X quita metadatos del Mac (propietario, atributos); se comprime el contenido de dist/.
execFileSync("zip", ["-r", "-q", "-X", zipPath, "."], { cwd: path.join(root, "dist"), stdio: "inherit" });

console.log(`Entregable: ${path.relative(root, zipPath)}`);
