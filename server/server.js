import express from "express";
import cors from "cors";
import routes from "./routes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (_req, res) => res.send("API Controle de Frete OK"));
app.use("/api", routes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`> API rodando em http://localhost:${PORT}`));
