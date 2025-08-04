import { FastifyInstance } from 'fastify';

export default async function routes(app: FastifyInstance) {
  app.get('/hello', async () => {
    return { message: 'Hello from EcoScope API' };
  });
}