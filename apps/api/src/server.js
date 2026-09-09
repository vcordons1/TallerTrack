import app from "./app.js";

const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new RangeError("PORT must be an integer between 1 and 65535");
}

const server = app.listen(port, () => {
  console.log(`TallerTrack API listening on port ${server.address().port}`);
});

function shutdown(signal) {
  server.close((error) => {
    if (error) {
      console.error("Failed to close the HTTP server", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
