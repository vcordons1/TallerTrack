import express from "express";

const app = express();

app.disable("x-powered-by");

app.get("/health/live", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

export default app;
