require("dotenv").config();
const app = require("./app");

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`API lista en http://localhost:${PORT}`);
  console.log(`Swagger en http://localhost:${PORT}/docs`);
});
