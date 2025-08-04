import Fastify from "fastify";
import exampleRoutes from "./routes/example";

const app = Fastify({ logger: true });
  app.register(exampleRoutes);


app.get("/ping", async (request, reply) => {
  return { pong: true };
});

const start = async () => {
  try {
    await app.listen({ port: 3001, host: "0.0.0.0" });
    console.log("🚀 Fastify server running on http://localhost:3001");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
